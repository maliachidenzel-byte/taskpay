import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, LogOut, Menu, X } from 'lucide-react';
import api from './lib/api.js';

const money = (value) => `$${Number(value).toFixed(2)}`;
const displayName = (email = '') => email.split('@')[0];

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState(window.location.pathname);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const navigate = (path) => {
    window.history.pushState({}, '', path);
    setPage(path);
    setMenuOpen(false);
  };

  useEffect(() => {
    const onPopState = () => setPage(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    api('/api/me')
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch(() => {
        localStorage.removeItem('rewards-token');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const signOut = () => {
    localStorage.removeItem('rewards-token');
    setUser(null);
    navigate('/');
  };

  const refreshUser = async () => {
    const result = await api('/api/me');
    setUser(result.user);
  };

  if (loading) return <Loading />;
  if (!user) return <AuthPage onSuccess={(newUser) => { setUser(newUser); navigate('/'); }} />;

  const isAdmin = user.isAdmin;
  const currentPage = page === '/tasks' || page === '/redeem' || (page === '/admin' && isAdmin) ? page : '/';

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate('/'); }}>TaskPay</a>
        <button className="mobile-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav className={`main-nav ${menuOpen ? 'nav-open' : ''}`} aria-label="Main navigation">
          <NavLink active={currentPage === '/'} label="Home" onClick={() => navigate('/')} />
          <NavLink active={currentPage === '/tasks'} label="Tasks" onClick={() => navigate('/tasks')} />
          <NavLink active={currentPage === '/redeem'} label="Payouts" onClick={() => navigate('/redeem')} />
          {isAdmin && <NavLink active={currentPage === '/admin'} label="Admin" onClick={() => navigate('/admin')} />}
          <div className="nav-account">
            <span className="user-name">{displayName(user.email)}</span>
            <button className="signout-button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
          </div>
        </nav>
      </header>
      <main className="main-content">
        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div>}
        {currentPage === '/' && <Dashboard user={user} onNavigate={navigate} onRefresh={refreshUser} onNotice={setNotice} />}
        {currentPage === '/tasks' && <TasksPage onRefresh={refreshUser} onNotice={setNotice} />}
        {currentPage === '/redeem' && <RedeemPage user={user} onRefresh={refreshUser} onNotice={setNotice} />}
        {currentPage === '/admin' && isAdmin && <AdminPage />}
      </main>
    </div>
  );
}

function Loading() {
  return <main className="loading-screen"><span className="spinner" aria-label="Loading" /></main>;
}

function NavLink({ active, label, onClick }) {
  return <button className={`nav-link ${active ? 'nav-active' : ''}`} onClick={onClick}>{label}</button>;
}

function PasswordField({ mode, value, onChange }) {
  const [visible, setVisible] = useState(false);
  const [typing, setTyping] = useState(false);
  const [pulse, setPulse] = useState(false);
  const typingTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(typingTimer.current), []);

  const handleChange = (event) => {
    onChange(event);
    setTyping(true);
    setPulse(false);
    window.requestAnimationFrame(() => setPulse(true));
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      setTyping(false);
      setPulse(false);
    }, 1000);
  };

  return (
    <span className={`password-field ${typing ? 'password-typing' : ''}`}>
      <input
        className={pulse ? 'password-pulse' : ''}
        type={visible ? 'text' : 'password'}
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        placeholder="At least 8 characters"
        value={value}
        onChange={handleChange}
        required
        minLength={8}
      />
      <button
        className="password-visibility"
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" />
            <path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.7 4.7 9.5 6-.3.5-1.3 1.8-3.1 3.2M6.2 6.2C3.9 7.7 2.7 9.7 2.5 11c.8 1.3 4.3 6 9.5 6 1 0 2-.2 2.8-.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </span>
  );
}

function AuthPage({ onSuccess }) {
  const [mode, setMode] = useState('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const authPath = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const { token, user } = await api(authPath, {
        method: 'POST',
        body: JSON.stringify({ email, password, ...(mode === 'register' && referralCode.trim() ? { referralCode: referralCode.trim() } : {}) }),
      });
      localStorage.setItem('rewards-token', token);
      onSuccess(user);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <a className="brand auth-brand" href="/">TaskPay</a>
        <h1>{mode === 'register' ? 'Do stuff. Get paid.' : 'Good to see you.'}</h1>
        <p>{mode === 'register' ? 'Make an account to get started.' : 'Sign in to pick up where you left off.'}</p>
        <form onSubmit={submit} className="auth-form">
          <label>Email<input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<PasswordField mode={mode} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {mode === 'register' && <label>Referral code (optional)<input type="text" placeholder="Friend’s code" value={referralCode} onChange={(event) => setReferralCode(event.target.value)} /></label>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
        </form>
        <div className="auth-toggle">
          {mode === 'register' ? 'Already have an account?' : 'New here?'}
          <button onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>{mode === 'register' ? 'Sign in' : 'Create account'}</button>
        </div>
      </section>
    </main>
  );
}

function PageHeading({ title, description }) {
  return <div className="page-heading"><h1>{title}</h1>{description && <p>{description}</p>}</div>;
}

function Dashboard({ user, onNavigate, onRefresh, onNotice }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [depositOpen, setDepositOpen] = useState(false);
  useEffect(() => {
    api('/api/dashboard')
      .then(async (data) => {
        setSummary(data);
        const { notifications } = await api('/api/referrals/notifications/claim', { method: 'POST' });
        if (notifications.length) {
          onNotice(notifications.map(({ amount }) => `You earned KES ${Number(amount).toLocaleString()} from a referral deposit!`).join(' '));
        }
      })
      .catch((problem) => setError(problem.message));
  }, []);

  const refreshDashboard = async () => {
    await onRefresh();
    setSummary(await api('/api/dashboard'));
  };

  return (
    <div className="page-content">
      <section className="balance-section">
        <p className="greeting">Hey {displayName(user.email)}</p>
        <p className="balance-label">Your balance</p>
        <div className="balance-main-row">
          <p className="balance-amount">{summary?.user.pointsAvailable?.toLocaleString() ?? '—'} <span>points</span></p>
          <button className="primary-button deposit-open-button" onClick={() => setDepositOpen((open) => !open)}>{depositOpen ? 'Cancel deposit' : 'Deposit'}</button>
        </div>
        <p className="conversion-note">100 points = $0.50</p>
        <button className="text-link" onClick={() => onNavigate('/redeem')}>Request a payout <ArrowRight size={16} /></button>
        {depositOpen && <DepositForm onComplete={() => { setDepositOpen(false); refreshDashboard().catch((problem) => setError(problem.message)); }} onUpdate={() => refreshDashboard().catch((problem) => setError(problem.message))} onNotice={onNotice} />}
      </section>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <section className="tasks-section">
        <div className="section-heading"><h2>Tasks</h2><button className="text-link" onClick={() => onNavigate('/tasks')}>All tasks <ArrowRight size={16} /></button></div>
        {summary ? <TaskList tasks={(summary.tasks || []).slice(0, 3)} onRefresh={refreshDashboard} onNotice={onNotice} /> : <Loading />}
      </section>
      {summary && <DashboardExtras summary={summary} user={user} onError={setError} onNotice={onNotice} />}
    </div>
  );
}

function DepositForm({ onComplete, onUpdate, onNotice }) {
  const [amount, setAmount] = useState('100');
  const [phone, setPhone] = useState('');
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState('');
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/deposits', { method: 'POST', body: JSON.stringify({ amount: Number(amount), phone }) });
      setReference(result.reference);
      setStatus(result.status);
      onUpdate();
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  };

  const checkStatus = async () => {
    setChecking(true);
    setError('');
    setStatus('CHECKING');
    const startedAt = Date.now();
    try {
      do {
        try {
          const result = await api(`/api/deposits/${encodeURIComponent(reference)}/status`);
          if (result.status === 'SUCCESS') {
            setStatus('SUCCESS');
            setError('');
            onNotice('Airtel Money deposit confirmed. Your balance has been updated.');
            onComplete();
            return;
          }
          if (result.status === 'FAILED') {
            setStatus('FAILED');
            setError('The payment was not completed. You can try another deposit.');
            onUpdate();
            return;
          }
          setStatus('PENDING');
        } catch (problem) {
          setError(problem.message);
        }
        const remaining = 60000 - (Date.now() - startedAt);
        if (remaining <= 0) break;
        await new Promise((resolve) => window.setTimeout(resolve, Math.min(5000, remaining)));
      } while (Date.now() - startedAt < 60000);
      setStatus('TIMEOUT');
    } finally {
      setChecking(false);
    }
  };

  return (
    <form className="deposit-form" onSubmit={submit}>
      {!reference && <>
        <label>Amount (KES)<input type="number" min="1" max="500" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
        <label>Airtel Money number<input type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
      </>}
      {error && <div className="form-error" role="alert">{error}</div>}
      {!reference ? (
        <button className="primary-button" disabled={busy}>{busy ? 'Requesting…' : 'Request payment'}</button>
      ) : (
        <div className="payment-status">
          <p>Check your phone. Enter your PIN to confirm.</p>
          <p className="deposit-help">Reference: {reference}</p>
          {status === 'TIMEOUT' && <p className="deposit-help">Still waiting. You can check again.</p>}
          {status === 'FAILED' && <button className="secondary-button" type="button" onClick={() => { setReference(''); setStatus(''); setError(''); }}>Try another deposit</button>}
          {status !== 'SUCCESS' && status !== 'FAILED' && <button className="primary-button" type="button" onClick={checkStatus} disabled={checking}>{checking ? 'Checking…' : 'Check status'}</button>}
        </div>
      )}
    </form>
  );
}

function DashboardExtras({ summary, user, onError, onNotice }) {
  const referrals = summary.referrals || { count: 0, earnings: 0, users: [] };
  const deposits = summary.deposits || [];

  const copyCode = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard access is unavailable in this browser.');
      await navigator.clipboard.writeText(user.referralCode || String(user.id));
      onNotice('Referral code copied.');
    } catch (problem) {
      onError(problem.message);
    }
  };

  return (
    <div className="dashboard-extras">
      <section className="extra-section">
        <div className="section-heading"><h2>Deposit history</h2></div>
        {deposits.length ? (
          <div className="content-card simple-list">
            {deposits.map((deposit) => <div className="history-row" key={deposit.id}><span>{new Date(deposit.date).toLocaleDateString()}<small className="deposit-status">{deposit.status.toLowerCase()}</small></span><span>{Number(deposit.amount).toLocaleString()} KES</span></div>)}
          </div>
        ) : <p className="empty-state">Your deposits will show up here.</p>}
      </section>
      <section className="extra-section">
        <div className="section-heading"><h2>Refer a friend</h2></div>
        <div className="content-card referral-code-card">
          <div><p className="balance-label">Your referral code</p><strong className="referral-code">{user.referralCode || user.id}</strong></div>
          <button className="secondary-button" onClick={copyCode}>Copy code</button>
        </div>
      </section>
      <section className="extra-section">
        <div className="section-heading"><h2>Referrals</h2></div>
        <div className="referral-summary content-card">
          <div><span>Total referrals</span><strong>{referrals.count}</strong></div>
          <div><span>Referral earnings</span><strong>{Number(referrals.earnings).toLocaleString()} KES</strong></div>
        </div>
        {referrals.users.length ? (
          <div className="content-card simple-list">
            {referrals.users.map((referral) => <div className="history-row referral-row" key={referral.id}>
              <span>{new Date(`${referral.referralDate.replace(' ', 'T')}Z`).toLocaleDateString()}</span>
              <span>{money(referral.depositAmount)} deposited</span>
            </div>)}
          </div>
        ) : <p className="empty-state">No referrals yet.</p>}
      </section>
    </div>
  );
}

function TasksPage({ onRefresh, onNotice }) {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/tasks').then(({ tasks: items }) => setTasks(items)).catch((problem) => setError(problem.message)); }, []);

  return (
    <div className="page-content">
      <PageHeading title="Tasks" description="Pick one and get started." />
      {error && <div className="inline-error" role="alert">{error}</div>}
      {tasks ? <TaskList tasks={tasks} onRefresh={onRefresh} onNotice={onNotice} /> : <Loading />}
    </div>
  );
}

function TaskList({ tasks, onRefresh, onNotice }) {
  const [activeTask, setActiveTask] = useState(null);
  const [watched, setWatched] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState(tasks);

  useEffect(() => setItems(tasks), [tasks]);

  const complete = async (task) => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/tasks/${task.id}/complete`, { method: 'POST' });
      setItems((current) => current.map((item) => item.id === task.id ? { ...item, completedToday: true } : item));
      setActiveTask(null);
      setWatched(0);
      await onRefresh();
      onNotice(`+${task.points} points added.`);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  };

  const begin = (task) => {
    if (task.type !== 'video') window.open(task.destination, '_blank', 'noopener,noreferrer');
    setActiveTask(task);
    setWatched(0);
  };

  return (
    <>
      {error && <div className="inline-error" role="alert">{error}</div>}
      {items.length && !items.every((task) => task.completedToday) ? (
        <div className="task-list">
          {items.map((task) => (
            <article className="task-row" key={task.id}>
              <div><h3>{task.title}</h3><p>+{task.points} points</p></div>
              <button className={task.completedToday ? 'task-button task-done' : 'task-button'} onClick={() => !task.completedToday && begin(task)} disabled={task.completedToday}>
                {task.completedToday ? <><Check size={16} /> Done</> : 'Start'}
              </button>
            </article>
          ))}
        </div>
      ) : <p className="empty-state">All done for today. Come back tomorrow.</p>}
      {activeTask && <TaskModal task={activeTask} watched={watched} setWatched={setWatched} busy={busy} onClose={() => { setActiveTask(null); setWatched(0); }} onComplete={() => complete(activeTask)} />}
    </>
  );
}

function TaskModal({ task, watched, setWatched, busy, onClose, onComplete }) {
  const [videoPlaying, setVideoPlaying] = useState(false);
  useEffect(() => {
    if (!videoPlaying || task.type !== 'video') return undefined;
    const timer = window.setInterval(() => setWatched((seconds) => Math.min(30, seconds + 1)), 1000);
    return () => window.clearInterval(timer);
  }, [videoPlaying, task.type, setWatched]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="task-modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <h2>{task.title}</h2>
        <p>{task.type === 'video' ? 'Watch for 30 seconds to get your points.' : 'When you’re done, come back here to claim your points.'}</p>
        {task.type === 'video' && (
          <div className="video-wrap">
            <video controls playsInline onPlay={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)} onEnded={() => { setVideoPlaying(false); setWatched(30); }} onTimeUpdate={(event) => { if (event.currentTarget.currentTime >= 30) { setVideoPlaying(false); setWatched(30); } }}>
              <source src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" type="video/mp4" />
            </video>
            <p className="video-count">{watched >= 30 ? 'Ready to claim.' : `Watch for ${30 - watched} more seconds.`}</p>
          </div>
        )}
        <button className="primary-button modal-action" onClick={onComplete} disabled={busy || (task.type === 'video' && watched < 30)}>
          {busy ? 'Adding points…' : task.type === 'video' ? 'Claim points' : 'I’m done'}
        </button>
      </section>
    </div>
  );
}

function RedeemPage({ user, onRefresh, onNotice }) {
  const [points, setPoints] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [payouts, setPayouts] = useState([]);
  const available = user.pointsAvailable || 0;
  const redeemable = Math.floor(available / 100) * 100;
  const amount = (Math.min(points, redeemable) / 100) * 0.5;

  useEffect(() => { api('/api/payouts').then(({ payouts: items }) => setPayouts(items)).catch((problem) => setError(problem.message)); }, []);
  useEffect(() => { if (redeemable > 0) setPoints((value) => Math.min(Math.max(100, value), redeemable)); }, [redeemable]);

  const request = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/api/payouts', { method: 'POST', body: JSON.stringify({ points }) });
      await onRefresh();
      const { payouts: items } = await api('/api/payouts');
      setPayouts(items);
      onNotice(`${money(amount)} payout request sent.`);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-content">
      <PageHeading title="Payouts" description="Turn your points into cash." />
      <section className="content-card payout-card">
        <p className="balance-label">Your balance</p>
        <p className="balance-amount small-balance">{available.toLocaleString()} <span>points</span></p>
        <p className="conversion-note">Up to {money(redeemable / 100 * 0.5)}</p>
        <div className="form-divider" />
        {error && <div className="form-error" role="alert">{error}</div>}
        {redeemable >= 100 ? (
          <>
            <label className="range-label" htmlFor="points-range"><span>Points to cash out</span><strong>{points.toLocaleString()}</strong></label>
            <input id="points-range" className="points-range" type="range" min="100" max={redeemable} step="100" value={Math.min(points, redeemable)} onChange={(event) => setPoints(Number(event.target.value))} />
            <div className="range-ends"><span>100</span><span>{redeemable.toLocaleString()}</span></div>
            <div className="payout-estimate"><span>Estimated payout</span><strong>{money(amount)}</strong></div>
            <button className="primary-button payout-button" disabled={busy} onClick={request}>{busy ? 'Sending…' : 'Request payout'}</button>
          </>
        ) : <p className="empty-state">Earn 100 points to request a payout.</p>}
      </section>
      <section className="history-section">
        <h2>Recent requests</h2>
        {payouts.length ? payouts.map((payout) => (
          <div className="history-row" key={payout.id}><span>{money(payout.amount)}</span><span>{new Date(payout.createdAt).toLocaleDateString()}</span><span className="pending-status">{payout.status}</span></div>
        )) : <p className="empty-state">No payout requests yet.</p>}
      </section>
    </div>
  );
}

function AdminPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/admin').then(setData).catch((problem) => setError(problem.message)); }, []);

  return (
    <div className="page-content">
      <PageHeading title="Admin" description="Member accounts and payout totals." />
      {error && <div className="inline-error" role="alert">{error}</div>}
      {data ? (
        <>
          <p className="admin-summary">{data.totalUsers} members · {money(data.totalPayouts)} requested · {data.totalPoints.toLocaleString()} points earned</p>
          <section className="content-card table-card">
            <div className="table-scroll"><table><thead><tr><th>Member</th><th>Balance</th><th>Earned</th><th>Payouts</th><th>Joined</th></tr></thead><tbody>
              {data.users.map((member) => <tr key={member.id}><td>{member.email}</td><td>{member.pointsAvailable.toLocaleString()} pts</td><td>{member.pointsEarned.toLocaleString()} pts</td><td>{money(member.payoutTotal)}</td><td>{new Date(member.createdAt).toLocaleDateString()}</td></tr>)}
            </tbody></table>{!data.users.length && <p className="empty-state">No members yet.</p>}</div>
          </section>
        </>
      ) : <Loading />}
    </div>
  );
}

export default App;
