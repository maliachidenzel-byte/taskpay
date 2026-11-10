import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { isSupabaseConfigured, supabase } from './services/db.js';
import { checkPaymentStatus, requestPayment } from './services/airtel.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;
const jwtSecret = process.env.JWT_SECRET || 'local-development-secret-change-before-deploying';
const adminEmail = (process.env.ADMIN_EMAIL || 'admin@taskrewards.test').toLowerCase();

const tasks = [
  { id: 'watch-video', type: 'video', title: 'A tiny ad break', description: 'Take a 30-second breather with a short video.', points: 5, duration: '30 sec' },
  { id: 'visit-partner', type: 'visit', title: 'Find something new', description: 'Visit our featured partner and see what they’re about.', points: 10, duration: '1 min', destination: 'https://example.com' },
  { id: 'partner-signup', type: 'signup', title: 'Join the good stuff', description: 'Sign up with a partner to unlock a bigger thank-you.', points: 50, duration: '2 min', destination: 'https://example.com' },
];

const asyncHandler = (handler) => (request, response, next) => (
  Promise.resolve(handler(request, response, next)).catch(next)
);

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

app.use(cors());
app.use(express.json({ limit: '20kb' }));
app.use('/api', (request, response, next) => {
  if (!isSupabaseConfigured) {
    return response.status(503).json({ error: 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable the API.' });
  }
  next();
});

const providerPaymentStatus = (payload) => {
  const status = String(payload?.data?.transaction?.status || payload?.transaction?.status || payload?.status?.code || payload?.status || '').toUpperCase();
  if (['TS', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED'].includes(status)) return 'SUCCESS';
  if (['TF', 'FAILED', 'FAILURE', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(status)) return 'FAILED';
  return 'PENDING';
};

const reconcileAirtelPayment = async (reference, providerResponse) => {
  const { data: payment, error } = await supabase
    .from('airtel_transactions')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();
  if (error) throw error;
  if (!payment) return null;

  const status = providerPaymentStatus(providerResponse);
  if (status === 'PENDING') return { status, referralBonus: null };
  if (status === 'FAILED') {
    if (!payment.credited) {
      unwrap(await supabase.from('airtel_transactions')
        .update({ status })
        .eq('reference', reference)
        .eq('credited', false));
    }
    return { status, referralBonus: null };
  }

  return unwrap(await supabase.rpc('credit_airtel_payment', { p_reference: reference }));
};

const paymentReferenceFromWebhook = (body) => (
  body?.transaction?.id ||
  body?.transaction?.reference ||
  body?.data?.transaction?.id ||
  body?.data?.transaction?.reference ||
  body?.reference ||
  body?.transactionId
);

const publicUser = (user) => ({
  id: user.id,
  referralCode: String(user.id),
  email: user.email,
  pointsAvailable: user.points_available,
  pointsEarned: user.points_earned,
  isAdmin: user.email.toLowerCase() === adminEmail,
  createdAt: user.created_at,
});

const authenticate = asyncHandler(async (request, response, next) => {
  const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return response.status(401).json({ error: 'Please sign in to continue.' });

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return response.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  const { data: user, error } = await supabase.from('users').select('*').eq('id', payload.userId).maybeSingle();
  if (error) throw error;
  if (!user) return response.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  request.user = user;
  next();
});

const requireAdmin = (request, response, next) => {
  if (request.user.email.toLowerCase() !== adminEmail) return response.status(403).json({ error: 'Admin access required.' });
  next();
};

const issueSession = (user, response) => {
  const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: '7d' });
  response.json({ token, user: publicUser(user) });
};

app.post('/api/auth/register', asyncHandler(async (request, response) => {
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = String(request.body.password || '');
  const referralCode = String(request.body.referralCode || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return response.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return response.status(400).json({ error: 'Password must be at least 8 characters.' });

  let referrerId = null;
  if (referralCode) {
    if (!/^\d+$/.test(referralCode) || !Number.isSafeInteger(Number(referralCode))) {
      return response.status(400).json({ error: 'That referral code is not valid.' });
    }
    referrerId = Number(referralCode);
    const { data: referrer, error } = await supabase.from('users').select('id').eq('id', referrerId).maybeSingle();
    if (error) throw error;
    if (!referrer) return response.status(400).json({ error: 'That referral code is not valid.' });
  }

  const { data: user, error } = await supabase.from('users').insert({
    email,
    password_hash: bcrypt.hashSync(password, 12),
    referrer_id: referrerId,
  }).select().single();
  if (error?.code === '23505') return response.status(409).json({ error: 'An account with that email already exists.' });
  if (error) throw error;
  issueSession(user, response);
}));

app.post('/api/auth/login', asyncHandler(async (request, response) => {
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = String(request.body.password || '');
  const { data: user, error } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
  if (error) throw error;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return response.status(401).json({ error: 'Email or password is incorrect.' });
  }
  issueSession(user, response);
}));

app.get('/api/me', authenticate, (request, response) => response.json({ user: publicUser(request.user) }));

app.get('/api/tasks', authenticate, asyncHandler(async (request, response) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = unwrap(await supabase.from('task_completions')
    .select('task_id')
    .eq('user_id', request.user.id)
    .eq('completed_day', today));
  const completed = new Set(rows.map((row) => row.task_id));
  response.json({ tasks: tasks.map((task) => ({ ...task, completedToday: completed.has(task.id) })) });
}));

app.get('/api/dashboard', authenticate, asyncHandler(async (request, response) => {
  const today = new Date().toISOString().slice(0, 10);
  const userResult = supabase.from('users').select('*').eq('id', request.user.id).single();
  const historyResult = supabase.from('task_completions')
    .select('id, task_id, points, created_at')
    .eq('user_id', request.user.id)
    .order('id', { ascending: false })
    .limit(8);
  const completionsResult = supabase.from('task_completions')
    .select('task_id')
    .eq('user_id', request.user.id)
    .eq('completed_day', today);
  const payoutsResult = supabase.from('payout_requests').select('amount').eq('user_id', request.user.id);
  const depositsResult = supabase.from('airtel_transactions')
    .select('id, amount, reference, status, date')
    .eq('user_id', request.user.id)
    .order('id', { ascending: false })
    .limit(5);
  const referralsResult = supabase.from('users')
    .select('id, email, created_at')
    .eq('referrer_id', request.user.id)
    .order('id', { ascending: false });
  const referralPayoutsResult = supabase.from('referral_payouts').select('amount').eq('referrer_id', request.user.id);

  const [user, historyRows, completedRows, payouts, deposits, referralRows, referralPayouts] = await Promise.all([
    userResult, historyResult, completionsResult, payoutsResult, depositsResult, referralsResult, referralPayoutsResult,
  ].map((query) => query.then(unwrap)));
  const referralIds = referralRows.map((referral) => referral.id);
  const successfulDeposits = referralIds.length
    ? unwrap(await supabase.from('airtel_transactions')
      .select('user_id, amount, id')
      .in('user_id', referralIds)
      .eq('status', 'SUCCESS')
      .order('id', { ascending: true }))
    : [];
  const firstDepositByUser = new Map();
  for (const deposit of successfulDeposits) {
    if (!firstDepositByUser.has(deposit.user_id)) firstDepositByUser.set(deposit.user_id, deposit.amount);
  }

  const history = historyRows.map((item) => {
    const task = tasks.find((candidate) => candidate.id === item.task_id);
    return {
      id: item.id,
      taskId: item.task_id,
      points: item.points,
      completedAt: item.created_at,
      title: task?.title || 'Completed task',
      type: task?.type || 'visit',
    };
  });
  const completedIds = new Set(completedRows.map((item) => item.task_id));
  const referrals = referralRows.map((referral) => ({
    id: referral.id,
    email: referral.email,
    referralDate: referral.created_at,
    depositAmount: firstDepositByUser.get(referral.id) || 0,
  }));
  response.json({
    user: publicUser(user),
    completedToday: completedRows.length,
    tasks: tasks.map((task) => ({ ...task, completedToday: completedIds.has(task.id) })),
    history,
    redeemedValue: payouts.reduce((total, payout) => total + Number(payout.amount), 0),
    deposits,
    referrals: {
      count: referrals.length,
      earnings: referralPayouts.reduce((total, payout) => total + Number(payout.amount), 0),
      users: referrals,
    },
  });
}));

app.post('/api/deposits', authenticate, asyncHandler(async (request, response) => {
  const amount = Number(request.body.amount);
  const phone = String(request.body.phone || '').replace(/\D/g, '');
  const countryCallingCode = process.env.AIRTEL_COUNTRY === 'KE' ? '254' : '';
  const localPhone = countryCallingCode && phone.startsWith(countryCallingCode) ? phone.slice(countryCallingCode.length) : phone.replace(/^0/, '');
  if (!/^\d{9}$/.test(localPhone)) {
    return response.status(400).json({ error: 'Enter a valid Airtel Money number.' });
  }
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 500) {
    return response.status(400).json({ error: 'Enter an amount from KES 1 to KES 500.' });
  }

  const reference = `TP-${randomUUID()}`;
  const { error: insertError } = await supabase.from('airtel_transactions').insert({
    user_id: request.user.id,
    phone: localPhone,
    amount,
    reference,
    status: 'INITIATED',
  });
  if (insertError) throw insertError;

  try {
    await requestPayment(localPhone, amount, reference);
  } catch (error) {
    const { error: updateError } = await supabase.from('airtel_transactions')
      .update({ status: 'FAILED' })
      .eq('reference', reference)
      .eq('status', 'INITIATED')
      .eq('credited', false);
    if (updateError) throw updateError;
    console.error('Airtel payment request failed:', error.message);
    return response.status(502).json({ error: 'Airtel Money could not start this payment. Check your number and try again.' });
  }

  const { error: updateError } = await supabase.from('airtel_transactions')
    .update({ status: 'PENDING' })
    .eq('reference', reference)
    .eq('status', 'INITIATED')
    .eq('credited', false);
  if (updateError) throw updateError;
  response.status(201).json({ message: 'Payment request sent.', reference, amount, status: 'PENDING' });
}));

app.get('/api/deposits/:reference/status', authenticate, asyncHandler(async (request, response) => {
  const { data: payment, error } = await supabase.from('airtel_transactions')
    .select('*')
    .eq('reference', request.params.reference)
    .eq('user_id', request.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!payment) return response.status(404).json({ error: 'Deposit not found.' });
  if (payment.credited) return response.json({ reference: payment.reference, status: 'SUCCESS' });

  const providerResponse = await checkPaymentStatus(payment.reference);
  const result = await reconcileAirtelPayment(payment.reference, providerResponse);
  if (!result) return response.status(404).json({ error: 'Deposit not found.' });
  response.json({ reference: payment.reference, status: result.status, referralBonus: result.referralBonus });
}));

app.post('/api/webhooks/airtel', asyncHandler(async (request, response) => {
  const reference = paymentReferenceFromWebhook(request.body);
  if (typeof reference !== 'string' || !reference) return response.status(400).json({ error: 'A transaction reference is required.' });
  const { data: payment, error } = await supabase.from('airtel_transactions')
    .select('reference')
    .eq('reference', reference)
    .maybeSingle();
  if (error) throw error;
  if (!payment) return response.status(404).json({ error: 'Transaction not found.' });

  // Verify callbacks against Airtel's status API before changing a balance.
  const providerResponse = await checkPaymentStatus(reference);
  const result = await reconcileAirtelPayment(reference, providerResponse);
  if (!result) return response.status(404).json({ error: 'Transaction not found.' });
  response.json({ received: true, status: result.status });
}));

app.post('/api/referrals/notifications/claim', authenticate, asyncHandler(async (request, response) => {
  const notifications = unwrap(await supabase.rpc('claim_referral_notifications', {
    p_referrer_id: request.user.id,
  }));
  response.json({ notifications: notifications.map(({ amount }) => ({ amount })) });
}));

app.post('/api/tasks/:taskId/complete', authenticate, asyncHandler(async (request, response) => {
  const task = tasks.find((item) => item.id === request.params.taskId);
  if (!task) return response.status(404).json({ error: 'That task could not be found.' });
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc('complete_task', {
    p_user_id: request.user.id,
    p_task_id: task.id,
    p_completed_day: today,
    p_points: task.points,
  });
  if (error?.code === '23505') {
    return response.status(409).json({ error: 'You’ve already completed this task today. Check back tomorrow.' });
  }
  if (error) throw error;
  response.status(201).json({ message: 'Task completed.', points: task.points, completionId: data });
}));

app.get('/api/payouts', authenticate, asyncHandler(async (request, response) => {
  const payouts = unwrap(await supabase.from('payout_requests')
    .select('id, points, amount, status, created_at')
    .eq('user_id', request.user.id)
    .order('id', { ascending: false })
    .limit(20))
    .map(({ id, points, amount, status, created_at }) => ({
      id,
      points,
      amount: Number(amount),
      status,
      createdAt: created_at,
    }));
  response.json({ payouts });
}));

app.post('/api/payouts', authenticate, asyncHandler(async (request, response) => {
  const points = Number(request.body.points);
  if (!Number.isSafeInteger(points) || points < 100 || points % 100 !== 0) {
    return response.status(400).json({ error: 'Payouts must be requested in increments of 100 points.' });
  }
  const amount = points / 100 * 0.5;
  const result = unwrap(await supabase.rpc('request_payout', {
    p_user_id: request.user.id,
    p_points: points,
    p_amount: amount,
  }));
  if (result.error === 'INSUFFICIENT_POINTS') {
    return response.status(400).json({ error: 'You don’t have enough available points for that payout.' });
  }
  console.log(`[payout] request ${result.payoutId}: user ${request.user.id}, ${points} points, $${amount.toFixed(2)}`);
  response.status(201).json({ message: 'Payout request recorded.', payoutId: result.payoutId, points, amount });
}));

app.get('/api/admin', authenticate, requireAdmin, asyncHandler(async (request, response) => {
  const [users, payouts] = await Promise.all([
    supabase.from('users')
      .select('id, email, points_available, points_earned, created_at')
      .order('created_at', { ascending: false })
      .then(unwrap),
    supabase.from('payout_requests').select('user_id, amount').then(unwrap),
  ]);
  const payoutTotals = new Map();
  for (const payout of payouts) {
    payoutTotals.set(payout.user_id, (payoutTotals.get(payout.user_id) || 0) + Number(payout.amount));
  }
  response.json({
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      pointsAvailable: user.points_available,
      pointsEarned: user.points_earned,
      createdAt: user.created_at,
      payoutTotal: payoutTotals.get(user.id) || 0,
    })),
    totalUsers: users.length,
    totalPayouts: payouts.reduce((total, payout) => total + Number(payout.amount), 0),
    totalPoints: users.reduce((total, user) => total + Number(user.points_earned), 0),
  });
}));

app.use((error, request, response, next) => {
  console.error(error);
  if (response.headersSent) return next(error);
  response.status(500).json({ error: 'Something went wrong on our end.' });
});

app.listen(port, () => console.log(`TaskPay API listening on http://localhost:${port}`));
