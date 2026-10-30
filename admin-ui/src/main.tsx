import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import clsx from 'clsx';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  Download,
  Gamepad2,
  History,
  Link2,
  Home,
  LockKeyhole,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings,
  Shield,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import './styles.css';

const SESSION_KEY = 'habeshabingo_admin_session';

type AdminData = Record<string, any>;
type TabKey =
  | 'work'
  | 'overview'
  | 'players'
  | 'payments'
  | 'requests'
  | 'games'
  | 'finance'
  | 'admins'
  | 'settings'
  | 'history'
  | 'account';

type EmitFn = (event: string, payload?: any) => void;
type ActionField = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'textarea' | 'select';
  placeholder?: string;
  value?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
};
type ActionRequest = {
  title: string;
  description?: React.ReactNode;
  fields?: ActionField[];
  summary?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: 'primary' | 'green' | 'red' | 'amber';
};
type AskAction = (request: ActionRequest) => Promise<Record<string, string> | null>;

function fmtMoney(value: any) {
  const n = Number(value || 0);
  return `${Number.isFinite(n) ? n.toLocaleString() : '0'} ETB`;
}

function fmtTime(value: any) {
  const d = new Date(value || 0);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function copyToClipboard(value: string) {
  if (!value) return;
  navigator.clipboard?.writeText(value).catch(() => {});
}

function escText(value: any) {
  return String(value ?? '');
}

function currentAdmin(data: AdminData | null) {
  return data?.currentAdmin || null;
}

function can(data: AdminData | null, permission: string) {
  return Boolean(currentAdmin(data)?.permissions?.includes(permission));
}

function roleLabel(data: AdminData | null) {
  const a = currentAdmin(data);
  return a?.roleLabel || a?.role || 'Admin';
}

function statusTone(status: string) {
  const s = String(status || '').toLowerCase();
  if (['active', 'approved', 'approved_auto', 'approved_manual', 'auto_credited', 'success', 'paid'].includes(s)) return 'green';
  if (['pending', 'countdown', 'manual_review', 'received'].includes(s)) return 'amber';
  if (['rejected', 'expired', 'suspended', 'duplicate_reference', 'unmatched', 'failed'].includes(s)) return 'red';
  if (['playing', 'running', 'spinning'].includes(s)) return 'blue';
  return 'slate';
}

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide',
        tone === 'green' && 'border-emerald-400/25 bg-emerald-500/12 text-emerald-300',
        tone === 'amber' && 'border-amber-300/25 bg-amber-400/12 text-amber-200',
        tone === 'red' && 'border-red-400/25 bg-red-500/12 text-red-300',
        tone === 'blue' && 'border-sky-400/25 bg-sky-500/12 text-sky-300',
        tone === 'purple' && 'border-violet-400/25 bg-violet-500/12 text-violet-300',
        tone === 'slate' && 'border-slate-400/20 bg-slate-500/10 text-slate-300',
      )}
    >
      {children}
    </span>
  );
}

function Button({
  children,
  onClick,
  tone = 'ghost',
  className,
  disabled,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: 'primary' | 'green' | 'red' | 'amber' | 'ghost' | 'dark';
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        tone === 'primary' && 'bg-gradient-to-r from-yellow-300 to-amber-500 text-slate-950 shadow-lg shadow-yellow-500/15',
        tone === 'green' && 'bg-emerald-500 text-emerald-950',
        tone === 'red' && 'bg-red-500 text-white',
        tone === 'amber' && 'bg-amber-500 text-slate-950',
        tone === 'dark' && 'border border-slate-700 bg-slate-950/80 text-slate-200',
        tone === 'ghost' && 'border border-slate-700/80 bg-slate-800/70 text-slate-200 hover:border-yellow-300/35',
        className,
      )}
    >
      {children}
    </button>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={clsx('glass-panel rounded-2xl p-4 sm:p-5', className)}>{children}</section>;
}

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'gold',
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: any;
  tone?: 'gold' | 'green' | 'blue' | 'red' | 'purple';
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-black text-white">{value}</div>
          {sub && <div className="mt-1 text-xs font-semibold text-slate-400">{sub}</div>}
        </div>
        {Icon && (
          <div
            className={clsx(
              'rounded-2xl border p-3',
              tone === 'gold' && 'border-yellow-300/20 bg-yellow-300/10 text-yellow-200',
              tone === 'green' && 'border-emerald-300/20 bg-emerald-400/10 text-emerald-300',
              tone === 'blue' && 'border-sky-300/20 bg-sky-400/10 text-sky-300',
              tone === 'red' && 'border-red-300/20 bg-red-400/10 text-red-300',
              tone === 'purple' && 'border-violet-300/20 bg-violet-400/10 text-violet-300',
            )}
          >
            <Icon size={21} />
          </div>
        )}
      </div>
    </Card>
  );
}

function Table({ headers, rows, empty = 'No data yet' }: { headers: string[]; rows: React.ReactNode[][]; empty?: string }) {
  return (
    <div className="table-shell scrollbar-soft overflow-x-auto rounded-2xl border border-slate-700/70 bg-slate-950/38">
      <table>
        <thead>
          <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)
          ) : (
            <tr>
              <td colSpan={headers.length} className="text-center text-slate-500">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-bold text-slate-300">
      <span className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        className="min-h-11 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-slate-100 outline-none transition focus:border-yellow-300/60"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 6,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-bold text-slate-300">
      <span className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-slate-100 outline-none transition focus:border-yellow-300/60"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-bold text-slate-300">
      <span className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-slate-100 outline-none transition focus:border-yellow-300/60"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Modal({
  title,
  children,
  onClose,
  locked = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  locked?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="glass-panel max-h-[92vh] w-full max-w-2xl overflow-auto rounded-t-3xl p-5 shadow-2xl sm:max-h-[88vh] sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-white">{title}</h2>
          {!locked && (
            <Button tone="dark" onClick={onClose} className="min-h-9 px-3">
              <X size={16} />
            </Button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function Toasts({ toasts, remove }: { toasts: Array<{ id: number; type: string; message: string }>; remove: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[60] grid w-[min(420px,calc(100vw-2rem))] gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => remove(t.id)}
          className={clsx(
            'rounded-2xl border p-4 text-left text-sm font-bold shadow-2xl backdrop-blur',
            t.type === 'error' && 'border-red-400/30 bg-red-950/90 text-red-100',
            t.type === 'success' && 'border-emerald-400/30 bg-emerald-950/90 text-emerald-100',
            t.type !== 'error' && t.type !== 'success' && 'border-amber-400/30 bg-amber-950/90 text-amber-100',
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}

function ActionDialog({
  request,
  onCancel,
  onSubmit,
}: {
  request: (ActionRequest & { resolve: (values: Record<string, string> | null) => void }) | null;
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!request) return;
    const next: Record<string, string> = {};
    (request.fields || []).forEach((field) => {
      next[field.name] = field.value || '';
    });
    setValues(next);
  }, [request]);

  if (!request) return null;

  const fields = request.fields || [];
  const invalid = fields.some((field) => field.required && !String(values[field.name] || '').trim());

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="glass-panel max-h-[92vh] w-full overflow-auto rounded-t-3xl p-5 shadow-2xl sm:max-w-xl sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-white">{request.title}</h2>
            {request.description && <div className="mt-1 text-sm font-semibold leading-6 text-slate-400">{request.description}</div>}
          </div>
          <Button tone="dark" onClick={onCancel} className="min-h-9 shrink-0 px-3">
            <X size={16} />
          </Button>
        </div>
        {request.summary && (
          <div className="mb-4 rounded-2xl border border-yellow-300/20 bg-yellow-300/8 p-3 text-sm font-semibold leading-6 text-yellow-50">
            {request.summary}
          </div>
        )}
        <div className="grid gap-3">
          {fields.map((field) => {
            if (field.type === 'textarea') {
              return (
                <TextArea
                  key={field.name}
                  label={`${field.label}${field.required ? ' *' : ''}`}
                  value={values[field.name] || ''}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
                  rows={4}
                />
              );
            }
            if (field.type === 'select') {
              return (
                <SelectField
                  key={field.name}
                  label={`${field.label}${field.required ? ' *' : ''}`}
                  value={values[field.name] || ''}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
                  options={field.options || []}
                />
              );
            }
            return (
              <Field
                key={field.name}
                label={`${field.label}${field.required ? ' *' : ''}`}
                value={values[field.name] || ''}
                onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
                type={field.type || 'text'}
                placeholder={field.placeholder}
              />
            );
          })}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button tone="dark" onClick={onCancel}>
            {request.cancelText || 'Cancel'}
          </Button>
          <Button tone={request.tone || 'primary'} disabled={invalid} onClick={() => onSubmit(values)}>
            {request.confirmText || 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LoginPage({
  onLogin,
  notify,
}: {
  onLogin: (socket: Socket, data: AdminData, token?: string) => void;
  notify: (type: string, message: string) => void;
}) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [resetUser, setResetUser] = useState('');
  const [resetPhone, setResetPhone] = useState('');

  const submit = () => {
    if (!username.trim() || !password.trim()) {
      notify('error', 'Enter username and password.');
      return;
    }
    setBusy(true);
    const s = io();
    s.on('connect', () => s.emit('adminLogin', { username, password }));
    s.once('adminAuth', (res: any) => {
      setBusy(false);
      if (res.success) onLogin(s, res.data, res.token);
      else {
        notify('error', res.message || 'Wrong admin login.');
        s.disconnect();
      }
    });
    s.on('connect_error', () => {
      setBusy(false);
      notify('error', 'Cannot connect to server.');
      s.disconnect();
    });
  };

  const requestReset = () => {
    if (!resetUser.trim() || !resetPhone.trim()) {
      notify('error', 'Username and phone are required.');
      return;
    }
    const s = io();
    s.on('connect', () => s.emit('adminForgotPasswordRequest', { username: resetUser, phone: resetPhone }));
    s.on('notification', (n: any) => {
      notify(n.type || 'success', n.message || 'Request sent.');
      s.disconnect();
      setForgot(false);
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md rounded-3xl p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-2xl bg-yellow-300 p-3 text-slate-950">
            <Shield size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">HabeshaBingo Admin</h1>
            <p className="text-sm font-semibold text-slate-400">Secure operations dashboard</p>
          </div>
        </div>
        <div className="grid gap-4">
          <Field label="Username / Phone" value={username} onChange={setUsername} />
          <Field label="Password" value={password} onChange={setPassword} type="password" />
          <Button tone="primary" disabled={busy} onClick={submit}>
            <LockKeyhole size={17} /> {busy ? 'Signing in...' : 'Sign In'}
          </Button>
          <Button tone="ghost" onClick={() => setForgot(true)}>
            Request Password Reset
          </Button>
        </div>
      </Card>
      {forgot && (
        <Modal title="Request Password Reset" onClose={() => setForgot(false)}>
          <div className="grid gap-4">
            <p className="text-sm text-slate-400">Master Admin will receive this request through the admin alert channel.</p>
            <Field label="Admin Username" value={resetUser} onChange={setResetUser} />
            <Field label="Registered Phone" value={resetPhone} onChange={setResetPhone} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setForgot(false)}>Cancel</Button>
              <Button tone="primary" onClick={requestReset}>
                Send Request
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

const baseNav: Array<{ key: TabKey; label: string; icon: any; permission?: string; masterOnly?: boolean }> = [
  { key: 'work', label: "Today's Work", icon: ClipboardList },
  { key: 'overview', label: 'Overview', icon: Home },
  { key: 'players', label: 'Players', icon: Users },
  { key: 'payments', label: 'Payments', icon: CreditCard },
  { key: 'requests', label: 'Requests', icon: Bell },
  { key: 'games', label: 'Games', icon: Gamepad2 },
  { key: 'finance', label: 'Finance', icon: Wallet },
  { key: 'history', label: 'History & Audit', icon: History },
  { key: 'admins', label: 'Admins', icon: UserCog, permission: 'manage_admins' },
  { key: 'settings', label: 'Settings', icon: Settings, permission: 'settings' },
  { key: 'account', label: 'My Account', icon: Shield },
];

function Layout({
  data,
  tab,
  setTab,
  children,
  onRefresh,
  onLogout,
}: {
  data: AdminData;
  tab: TabKey;
  setTab: (tab: TabKey) => void;
  children: React.ReactNode;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const admin = currentAdmin(data);
  const nav = baseNav.filter((item) => !item.permission || can(data, item.permission));

  const select = (key: TabKey) => {
    setTab(key);
    setOpen(false);
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[280px_1fr]">
      <button
        className="fixed left-4 top-4 z-40 rounded-xl border border-slate-700 bg-slate-950/90 p-3 text-white shadow-2xl lg:hidden"
        onClick={() => setOpen(true)}
      >
        <Menu size={20} />
      </button>
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-slate-800 bg-slate-950/96 p-4 transition lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-yellow-300 p-2.5 text-slate-950">
              <Shield size={22} />
            </div>
            <div>
              <div className="font-black text-white">HabeshaBingo</div>
              <div className="text-xs font-bold text-slate-500">Admin Console</div>
            </div>
          </div>
          <button className="text-slate-400 lg:hidden" onClick={() => setOpen(false)}>
            <X size={20} />
          </button>
        </div>
        <Card className="mb-4 rounded-2xl p-3">
          <div className="text-sm font-black text-white">{admin?.name || admin?.username || 'Admin'}</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <Badge tone={admin?.role === 'master' ? 'amber' : 'blue'}>{roleLabel(data)}</Badge>
            <span className="text-[11px] font-bold text-slate-500">{admin?.username}</span>
          </div>
        </Card>
        <nav className="scrollbar-soft grid gap-1 overflow-auto pr-1">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => select(item.key)}
                className={clsx(
                  'flex min-h-11 items-center gap-3 rounded-xl px-3 text-left text-sm font-black transition',
                  tab === item.key ? 'bg-yellow-300 text-slate-950' : 'text-slate-400 hover:bg-slate-900 hover:text-white',
                )}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto grid gap-2 pt-4">
          <Button tone="dark" onClick={onRefresh}>
            <RefreshCw size={16} /> Refresh
          </Button>
          <Button tone="ghost" onClick={onLogout}>
            <LogOut size={16} /> Logout
          </Button>
        </div>
      </aside>
      {open && <button className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={() => setOpen(false)} />}
      <main className="min-w-0 p-4 pt-20 sm:p-6 lg:p-8 lg:pt-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}

function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-black text-white sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm font-semibold text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function WorkPage({ data, emit, ask }: { data: AdminData; emit: EmitFn; ask: AskAction }) {
  const requests = data.requests || [];
  const pendingDeposits = requests.filter((r: any) => r.status === 'pending' && r.type === 'deposit');
  const pendingWithdrawals = requests.filter((r: any) => r.status === 'pending' && r.type === 'withdraw');
  const reviewSms = (data.paymentSmsInbox || []).filter((x: any) => ['manual_review', 'received', 'unmatched'].includes(x.status)).slice(0, 10);
  const myFloat = Number(currentAdmin(data)?.withdrawalFloatBalance || 0);

  const resolve = async (req: any, action: 'approve' | 'reject') => {
    const target = req.type === 'deposit' ? 'credited to' : 'processed for';
    const result = await ask({
      title: `${action === 'approve' ? 'Approve' : 'Reject'} ${req.type} request`,
      description: 'This action is audited and updates the player request immediately.',
      summary: (
        <div>
          <b>{fmtMoney(req.amount)}</b> will be {target} <b>{req.playerName || req.playerId}</b>.
        </div>
      ),
      fields: [{ name: 'note', label: 'Note / Reference', type: 'textarea', required: true }],
      confirmText: action === 'approve' ? 'Approve Request' : 'Reject Request',
      tone: action === 'approve' ? 'green' : 'red',
    });
    if (!result) return;
    emit('adminResolveWalletRequest', { requestId: req.id, action, note: result.note });
  };
  const reassignWithdrawal = async (req: any) => {
    const result = await ask({
      title: 'No Balance / Reassign',
      description: 'This keeps the player request pending and sends it to the next eligible Senior Admin with enough float.',
      summary: (
        <div>
          Withdrawal: <b>{fmtMoney(req.amount)}</b>
          <br />
          Current assignment: <b>{req.assignedWithdrawAdminName || 'Master review'}</b>
        </div>
      ),
      fields: [{ name: 'note', label: 'Reason', type: 'textarea', required: true }],
      confirmText: 'Reassign',
      tone: 'amber',
    });
    if (!result) return;
    emit('adminResolveWalletRequest', { requestId: req.id, action: 'decline', note: result.note });
  };

  return (
    <>
      <PageTitle title="Today’s Work" subtitle="Everything staff need to handle first: deposits, withdrawals, and player issues." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Pending Withdrawals" value={pendingWithdrawals.length} sub={fmtMoney(pendingWithdrawals.reduce((s: number, r: any) => s + Number(r.amount || 0), 0))} icon={CircleDollarSign} tone="red" />
        <MetricCard label="Pending Deposits" value={pendingDeposits.length} sub={fmtMoney(pendingDeposits.reduce((s: number, r: any) => s + Number(r.amount || 0), 0))} icon={CreditCard} tone="green" />
        <MetricCard label="My Withdraw Float" value={fmtMoney(myFloat)} sub={currentAdmin(data)?.role === 'senior' ? 'Available staff cash' : 'Master view'} icon={Wallet} tone="blue" />
        <MetricCard label="Payment Review" value={reviewSms.length} sub="SMS items needing eyes" icon={AlertTriangle} tone="gold" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Card>
          <SectionHeader title="Active Requests" icon={ClipboardList} />
          <Table
            headers={['Time', 'Player', 'Type', 'Amount', 'Assigned', 'Status', 'Actions']}
            rows={[...pendingWithdrawals, ...pendingDeposits].slice(0, 16).map((r: any) => [
              fmtTime(r.createdAt),
              <PlayerCell player={r} />,
              <Badge tone={r.type === 'withdraw' ? 'red' : 'green'}>{r.type}</Badge>,
              <b>{fmtMoney(r.amount)}</b>,
              r.type === 'withdraw' ? (
                <div>
                  <b>{r.assignedWithdrawAdminName || 'Master review'}</b>
                  {r.assignmentStatus && <div className="text-xs font-bold text-slate-500">{r.assignmentStatus}</div>}
                </div>
              ) : (r.depositAccountOwnerAdminName || '-'),
              <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
              can(data, 'resolve_requests') ? (
                <div className="flex flex-wrap gap-2">
                  <Button tone="green" className="min-h-8 px-3 text-xs" onClick={() => resolve(r, 'approve')}>
                    Approve
                  </Button>
                  <Button tone="red" className="min-h-8 px-3 text-xs" onClick={() => resolve(r, 'reject')}>
                    Reject
                  </Button>
                  {r.type === 'withdraw' && (
                    <Button tone="amber" className="min-h-8 px-3 text-xs" onClick={() => reassignWithdrawal(r)}>
                      No Balance
                    </Button>
                  )}
                </div>
              ) : (
                '-'
              ),
            ])}
          />
        </Card>
        <Card>
          <SectionHeader title="Payment SMS Review" icon={Bell} />
          <div className="grid gap-3">
            {reviewSms.length ? (
              reviewSms.map((item: any) => (
                <div key={item.id || item.reference || item.receivedAt} className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-black text-white">{fmtMoney(item.parsed?.amount || item.amount)}</div>
                    <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-400">{fmtTime(item.receivedAt || item.createdAt)} | Ref: {item.parsed?.reference || item.reference || '-'}</div>
                  <p className="mt-2 line-clamp-3 text-sm text-slate-300">{item.text || item.message || '-'}</p>
                </div>
              ))
            ) : (
              <EmptyState text="No SMS items need review." />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function SectionHeader({ title, icon: Icon, action }: { title: string; icon?: any; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="text-yellow-200" size={18} />}
        <h2 className="text-lg font-black text-white">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm font-bold text-slate-500">{text}</div>;
}

function PlayerCell({ player }: { player: any }) {
  return (
    <div>
      <div className="font-black text-white">{player.playerName || player.name || '-'}</div>
      <div className="text-xs font-semibold text-slate-500">{player.playerCode || player.phone || player.playerId || '-'}</div>
    </div>
  );
}

function StaffFloatSummary({ data, compact = false }: { data: AdminData; compact?: boolean }) {
  const rows = data.adminFloatSummary || [];
  const totalFloat = rows.reduce((sum: number, row: any) => sum + Number(row.withdrawalFloatBalance || 0), 0);
  const pendingAmount = rows.reduce((sum: number, row: any) => sum + Number(row.pendingWithdrawalAmount || 0), 0);
  const pendingCount = rows.reduce((sum: number, row: any) => sum + Number(row.pendingWithdrawals || 0), 0);
  return (
    <Card>
      <SectionHeader title={can(data, 'manage_admins') ? 'Senior Admin Cash Float' : 'My Withdrawal Float'} icon={Wallet} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MetricMini label="Total cash held" value={fmtMoney(totalFloat)} good={totalFloat >= pendingAmount} />
        <MetricMini label="Assigned withdrawals" value={pendingCount} />
        <MetricMini label="Pending amount" value={fmtMoney(pendingAmount)} good={totalFloat >= pendingAmount} />
      </div>
      {!compact && (
        <Table
          headers={['Admin', 'Username', 'Float Balance', 'Pending', 'Pending Amount', 'Status']}
          rows={rows.map((row: any) => [
            <b>{row.name}</b>,
            row.username || '-',
            <b>{fmtMoney(row.withdrawalFloatBalance)}</b>,
            row.pendingWithdrawals || 0,
            fmtMoney(row.pendingWithdrawalAmount || 0),
            <Badge tone={row.active ? 'green' : 'red'}>{row.active ? 'Active' : 'Disabled'}</Badge>,
          ])}
        />
      )}
    </Card>
  );
}

function AdminCashStatement({ data, compact = false }: { data: AdminData; compact?: boolean }) {
  const rows = data.adminCashStatements || [];
  const cashIn = rows.filter((r: any) => r.direction === 'in').reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
  const cashOut = rows.filter((r: any) => r.direction === 'out').reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
  const systemMoves = rows.filter((r: any) => r.direction === 'system').reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
  const title = can(data, 'manage_admins') ? 'Senior Admin Cash Statement' : 'My Cash Statement';
  const limitedRows = rows.slice(0, compact ? 8 : 160);
  return (
    <Card>
      <SectionHeader title={title} icon={ClipboardList} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MetricMini label="Cash In" value={fmtMoney(cashIn)} good />
        <MetricMini label="Cash Out" value={fmtMoney(cashOut)} />
        <MetricMini label="System Moves" value={fmtMoney(systemMoves)} />
      </div>
      <Table
        headers={can(data, 'manage_admins')
          ? ['Time', 'Admin', 'Movement', 'Amount', 'Float After', 'Player / Ref', 'Note']
          : ['Time', 'Movement', 'Amount', 'Float After', 'Player / Ref', 'Note']}
        rows={limitedRows.map((row: any) => {
          const movement = (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={row.direction === 'in' ? 'green' : row.direction === 'out' ? 'red' : 'blue'}>
                {row.direction === 'in' ? 'Cash In' : row.direction === 'out' ? 'Cash Out' : 'System'}
              </Badge>
              <span className="font-bold text-slate-200">{human(row.type || 'movement')}</span>
            </div>
          );
          const ref = (
            <div className="max-w-[220px]">
              <div className="font-bold text-white">{row.playerName || row.playerId || '-'}</div>
              <div className="break-all text-xs text-slate-500">{row.reference || row.requestId || row.source || '-'}</div>
            </div>
          );
          const cells = [
            fmtTime(row.time),
            movement,
            <b>{fmtMoney(row.amount)}</b>,
            fmtMoney(row.balanceAfter),
            ref,
            <span className="whitespace-normal">{row.note || '-'}</span>,
          ];
          if (can(data, 'manage_admins')) cells.splice(1, 0, <b>{row.adminName || row.adminUsername || '-'}</b>);
          return cells;
        })}
      />
      {!rows.length && <EmptyState text="No cash movement has been recorded yet." />}
    </Card>
  );
}

function OverviewPage({ data }: { data: AdminData }) {
  const players = data.players || [];
  const totalWagered = players.reduce((s: number, p: any) => s + Number(p.totalLost || 0), 0);
  const totalPaid = players.reduce((s: number, p: any) => s + Number(p.totalWon || 0), 0);
  const activePlayers = players.filter((p: any) => !p.suspended).length;
  const pending = (data.requests || []).filter((r: any) => r.status === 'pending').length;
  const visibleAccounts = Object.values(data.company?.accounts || {}).reduce((s: number, v: any) => s + Number(v || 0), 0);

  return (
    <>
      <PageTitle title="Overview" subtitle="A clean snapshot of platform health and current operational pressure." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Players" value={data.totalPlayers || players.length} sub={`${activePlayers} active`} icon={Users} tone="blue" />
        <MetricCard label={can(data, 'audit_all') ? 'Company Balance' : 'Visible Prize Vaults'} value={fmtMoney(can(data, 'audit_all') ? data.company?.balance : visibleAccounts)} sub={can(data, 'audit_all') ? `Commission ${fmtMoney(data.company?.totalCommission)}` : 'Prize liquidity only'} icon={Wallet} tone="green" />
        <MetricCard label="Active Games" value={data.activeGames || 0} sub={`${(data.games || []).length} rooms`} icon={Gamepad2} tone="purple" />
        <MetricCard label="Pending Work" value={pending} sub="Deposits & withdrawals" icon={Bell} tone="gold" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <StaffFloatSummary data={data} compact />
        <Card>
          <SectionHeader title="Live Rooms" icon={Activity} />
          <div className="grid gap-3 sm:grid-cols-2">
            {(data.games || []).slice(0, 8).map((g: any) => (
              <div key={`${g.game || 'bingo'}-${g.bet}`} className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black text-white">{g.game ? escText(g.game).toUpperCase() : `${g.bet} ETB Bingo`}</div>
                    <div className="mt-1 text-xs font-bold text-slate-500">{g.playerCount || 0} players | Pot {fmtMoney(g.pot)}</div>
                  </div>
                  <Badge tone={statusTone(g.status)}>{g.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <SectionHeader title="Recent Audit" icon={History} />
          <Table
            headers={['Time', 'Actor', 'Event', 'Details']}
            rows={(data.auditEvents || []).slice(0, 8).map((a: any) => [fmtTime(a.time), a.actorName || a.admin || 'system', <Badge tone="blue">{a.event || a.action}</Badge>, formatDetails(a.details)])}
          />
        </Card>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <MetricCard label="Total Wagered" value={fmtMoney(totalWagered)} sub={`Paid out ${fmtMoney(totalPaid)}`} icon={BarChart3} tone="gold" />
        <MetricCard label="Net Player P/L" value={fmtMoney(totalWagered - totalPaid)} sub="Positive means house ahead before other accounting" icon={CircleDollarSign} tone={totalWagered - totalPaid >= 0 ? 'green' : 'red'} />
      </div>
    </>
  );
}

function formatDetails(details: any) {
  if (!details || typeof details !== 'object') return '-';
  const priority = ['playerName', 'playerId', 'amount', 'fromAccount', 'toAccount', 'account', 'requestId', 'reference', 'reason', 'note', 'status'];
  return Object.entries(details)
    .filter(([k, v]) => !['socketId', 'ip'].includes(k) && v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => {
      const ai = priority.indexOf(a);
      const bi = priority.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .slice(0, 8)
    .map(([k, v]) => `${human(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' | ');
}

function human(key: string) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (m) => m.toUpperCase());
}

function PlayersPage({ data, emit, ask }: { data: AdminData; emit: EmitFn; ask: AskAction }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any>(null);
  const players = useMemo(() => {
    let list = [...(data.players || [])];
    if (filter === 'active') list = list.filter((p) => !p.suspended);
    if (filter === 'suspended') list = list.filter((p) => p.suspended);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => [p.name, p.phone, p.playerCode, p.playerId, p.telegramUsername].some((x) => String(x || '').toLowerCase().includes(q)));
    }
    return list;
  }, [data.players, filter, search]);

  const penalty = async (player: any, action: string) => {
    const isActivate = action === 'activate';
    const result = await ask({
      title: isActivate ? 'Reactivate Player' : 'Apply Player Penalty',
      description: isActivate ? 'The player will be allowed to play again.' : 'The player will receive a Telegram/system notice with the reason.',
      summary: (
        <div>
          Player: <b>{player.name}</b>
          <br />
          Action: <b>{isActivate ? 'Reactivate' : action}</b>
        </div>
      ),
      fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }],
      confirmText: isActivate ? 'Reactivate' : 'Apply Penalty',
      tone: isActivate ? 'green' : 'red',
    });
    if (!result) return;
    emit('adminTogglePlayer', { playerId: player.playerId, action, reason: result.reason });
  };

  const resetPin = async (player: any) => {
    const result = await ask({
      title: 'Reset Player PIN',
      description: 'Use this only after verifying the player identity. The action will be logged.',
      summary: <div>Player: <b>{player.name}</b></div>,
      fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }],
      confirmText: 'Reset PIN',
      tone: 'amber',
    });
    if (!result) return;
    emit('adminResetPin', { playerId: player.playerId, reason: result.reason });
  };

  const adjust = async (player: any) => {
    const result = await ask({
      title: 'Adjust Player Balance',
      description: 'Use + amount to credit and - amount to deduct. This is a sensitive audited action.',
      summary: (
        <div>
          Player: <b>{player.name}</b>
          <br />
          Current balance: <b>{fmtMoney(player.balance)}</b>
        </div>
      ),
      fields: [
        { name: 'amount', label: 'Amount (+ or -)', type: 'number', required: true },
        { name: 'reason', label: 'Reason', type: 'textarea', required: true },
      ],
      confirmText: 'Save Adjustment',
      tone: 'amber',
    });
    if (!result) return;
    const amount = Number(result.amount);
    if (!Number.isFinite(amount) || !amount) return;
    emit('adminAdjustBalance', { playerId: player.playerId, amount, reason: result.reason });
  };

  return (
    <>
      <PageTitle title="Players" subtitle="Search, profile, support, and responsible gaming controls." />
      <Card className="mb-5">
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, HB code, Telegram, or ID..." className="min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950/70 pl-10 pr-3 font-bold text-white outline-none focus:border-yellow-300/60" />
          </label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="min-h-12 rounded-xl border border-slate-700 bg-slate-950/70 px-3 font-bold text-white outline-none">
            <option value="all">All players</option>
            <option value="active">Active only</option>
            <option value="suspended">Suspended only</option>
          </select>
        </div>
      </Card>
      <Table
        headers={['Player', 'Phone', 'Balance', 'Won', 'Lost', 'Net', 'Games', 'Status', 'Actions']}
        rows={players.slice(0, 500).map((p: any) => [
          <PlayerCell player={p} />,
          p.phone || '-',
          <b>{fmtMoney(p.balance)}</b>,
          fmtMoney(p.totalWon),
          fmtMoney(p.totalLost),
          <span className={Number(p.netPnL || 0) >= 0 ? 'font-black text-emerald-300' : 'font-black text-red-300'}>{fmtMoney(p.netPnL)}</span>,
          p.gamesPlayed || 0,
          <Badge tone={p.suspended ? 'red' : 'green'}>{p.suspended ? 'Suspended' : 'Active'}</Badge>,
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-8 px-3 text-xs" onClick={() => setSelected(p)}>
              Profile
            </Button>
            {can(data, 'player_penalty') && (
              <>
                <Button tone="amber" className="min-h-8 px-3 text-xs" onClick={() => penalty(p, '30m')}>
                  30m
                </Button>
                <Button tone="red" className="min-h-8 px-3 text-xs" onClick={() => penalty(p, p.suspended ? 'activate' : '24h')}>
                  {p.suspended ? 'Activate' : '24h'}
                </Button>
              </>
            )}
            {can(data, 'player_balance_adjust') && (
              <Button tone="green" className="min-h-8 px-3 text-xs" onClick={() => adjust(p)}>
                Money
              </Button>
            )}
            {can(data, 'reset_pin') && (
              <Button className="min-h-8 px-3 text-xs" onClick={() => resetPin(p)}>
                PIN
              </Button>
            )}
          </div>,
        ])}
      />
      {selected && <PlayerModal player={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function PlayerModal({ player, onClose }: { player: any; onClose: () => void }) {
  const stats = player.adminStats || {};
  const byGame = Object.values(stats.byGame || {});
  return (
    <Modal title={`Player Profile: ${player.name}`} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard label="Balance" value={fmtMoney(player.balance)} icon={Wallet} tone="green" />
          <MetricCard label="Net P/L" value={fmtMoney(stats.netPnL ?? player.netPnL)} icon={BarChart3} tone={Number(stats.netPnL ?? player.netPnL) >= 0 ? 'green' : 'red'} />
          <MetricCard label="Games Played" value={stats.gamesPlayed || player.gamesPlayed || 0} icon={Gamepad2} tone="blue" />
          <MetricCard label="Wins" value={player.wins || 0} icon={Activity} tone="gold" />
        </div>
        <Card className="rounded-2xl">
          <div className="grid gap-2 text-sm font-bold text-slate-300 sm:grid-cols-2">
            <div>Phone: <span className="text-white">{player.phone || '-'}</span></div>
            <div>Player ID: <span className="text-white">{player.playerId}</span></div>
            <div>HB Code: <span className="text-white">{player.playerCode || '-'}</span></div>
            <div>Telegram: <span className="text-white">{player.telegramUsername || '-'}</span></div>
          </div>
        </Card>
        <Table
          headers={['Game', 'Played', 'Won', 'Lost', 'Net']}
          rows={(byGame as any[]).map((g) => [g.game, g.gamesPlayed || 0, fmtMoney(g.totalWon), fmtMoney(g.totalLost), <span className={Number(g.netPnL || 0) >= 0 ? 'font-black text-emerald-300' : 'font-black text-red-300'}>{fmtMoney(g.netPnL)}</span>])}
          empty="No game history for this player yet."
        />
      </div>
    </Modal>
  );
}

function PaymentsPage({ data, emit, ask }: { data: AdminData; emit: EmitFn; ask: AskAction }) {
  const accounts = (data.depositAccounts || []).filter((a: any) => a.status !== 'deleted');
  const seniorAdmins = (data.adminUsers || []).filter((admin: any) => admin.role === 'senior' && admin.active !== false);
  const sms = data.paymentSmsInbox || [];

  const createAccount = async () => {
    const result = await ask({
      title: 'Add Telebirr Deposit Account',
      description: 'Enter a real receiver account. New accounts are activated immediately and can receive deposit requests within the limits below.',
      summary: 'The account number is shown to players making deposits. Verify the number and receiver before saving.',
      fields: [
        { name: 'label', label: 'Account label', required: true },
        {
          name: 'ownerAdminId',
          label: 'Account owner',
          type: 'select',
          value: '',
          options: [
            { value: '', label: 'Unassigned (Master Admin managed)' },
            ...seniorAdmins.map((admin: any) => ({
              value: admin.id,
              label: `${admin.name || admin.username} (${admin.username})`,
            })),
          ],
        },
        { name: 'receiverName', label: 'Telebirr receiver name', required: true },
        { name: 'accountNumber', label: 'Telebirr account number', required: true },
        { name: 'minAmount', label: 'Minimum deposit (ETB)', type: 'number', value: '10', required: true },
        { name: 'maxAmount', label: 'Maximum deposit (ETB)', type: 'number', value: '100000', required: true },
        { name: 'dailyLimit', label: 'Daily deposit limit (ETB)', type: 'number', value: '100000', required: true },
      ],
      confirmText: 'Create & Activate',
      tone: 'green',
    });
    if (!result) return;
    emit('adminCreateDepositAccount', {
      label: result.label,
      ownerAdminId: result.ownerAdminId,
      receiverName: result.receiverName,
      accountNumber: result.accountNumber,
      minAmount: result.minAmount,
      maxAmount: result.maxAmount,
      dailyLimit: result.dailyLimit,
    });
  };

  const toggleAccount = async (a: any) => {
    const status = a.status === 'active' ? 'paused' : 'active';
    const result = await ask({
      title: `${status === 'active' ? 'Activate' : 'Pause'} Deposit Account`,
      description: 'This controls whether players can receive this Telebirr receiver number for new deposit requests.',
      summary: (
        <div>
          Account: <b>{a.label || a.accountNumber}</b>
          <br />
          New status: <b>{status}</b>
        </div>
      ),
      fields: [{ name: 'note', label: 'Reason', type: 'textarea', required: true }],
      confirmText: status === 'active' ? 'Activate' : 'Pause',
      tone: status === 'active' ? 'green' : 'amber',
    });
    if (!result) return;
    emit('adminSetDepositAccountStatus', { accountId: a.id, status, note: result.note });
  };

  return (
    <>
      <PageTitle
        title="Payments"
        subtitle="Telebirr receiver accounts and SMS payment inbox."
        action={can(data, 'settings') ? (
          <Button tone="primary" onClick={createAccount}>
            Add Deposit Account
          </Button>
        ) : undefined}
      />
      <Card className="mb-5">
        <div className="mb-3 rounded-xl border border-sky-400/20 bg-sky-500/5 p-3 text-sm font-semibold leading-6 text-sky-100">
          Deposits are available only when an active receiver account matches the deposit amount and has daily capacity. New accounts created here become active immediately.
          {!seniorAdmins.length && can(data, 'settings') && (
            <div className="mt-1 text-sky-200">No active Senior Admin is available; create an unassigned account managed by the Master Admin.</div>
          )}
        </div>
        <SectionHeader title="Telebirr Deposit Accounts" icon={CreditCard} />
        <Table
          headers={['Label', 'Senior Admin', 'Receiver', 'Number', 'Status', 'Load', 'Actions']}
          rows={accounts.map((a: any) => [
            <b>{a.label}</b>,
            a.ownerAdminName || '-',
            a.receiverName || '-',
            <code className="rounded bg-slate-950/80 px-2 py-1 text-yellow-200">{a.accountNumber || '-'}</code>,
            <Badge tone={statusTone(a.status)}>{a.status}</Badge>,
            `${a.pendingCount || 0} pending`,
            <div className="flex gap-2">
              {can(data, 'settings') || can(data, 'resolve_requests') ? (
                <Button className="min-h-8 px-3 text-xs" onClick={() => toggleAccount(a)}>
                  {a.status === 'active' ? 'Pause' : 'Activate'}
                </Button>
              ) : (
                '-'
              )}
            </div>,
          ])}
        />
      </Card>
      <Card>
        <SectionHeader title="SMS Inbox" icon={Bell} />
        <Table
          headers={['Time', 'Sender', 'Status', 'Amount', 'Reference', 'Match', 'Message']}
          rows={sms.slice(0, 200).map((item: any) => [
            fmtTime(item.receivedAt || item.createdAt),
            item.from || item.sender || '-',
            <Badge tone={statusTone(item.status)}>{item.status}</Badge>,
            fmtMoney(item.parsed?.amount || item.amount),
            item.parsed?.reference || item.reference || '-',
            item.matchedPlayerName || item.matchName || '-',
            <span className="line-clamp-2 max-w-md">{item.text || item.message || '-'}</span>,
          ])}
        />
      </Card>
    </>
  );
}

function RequestsPage({ data, emit, ask }: { data: AdminData; emit: EmitFn; ask: AskAction }) {
  const [playerQuery, setPlayerQuery] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const reqs = data.requests || [];
  const pending = reqs.filter((r: any) => r.status === 'pending');
  const deposits = pending.filter((r: any) => r.type === 'deposit');
  const withdrawals = pending.filter((r: any) => r.type === 'withdraw');

  const resolve = async (r: any, action: 'approve' | 'reject') => {
    const result = await ask({
      title: `${action === 'approve' ? 'Approve' : 'Reject'} Request`,
      description: 'The player wallet/request status will be updated immediately after confirmation.',
      summary: (
        <div>
          Player: <b>{r.playerName || r.playerId}</b>
          <br />
          Amount: <b>{fmtMoney(r.amount)}</b>
          <br />
          Type: <b>{r.type}</b>
          {r.type === 'withdraw' && Number(r.fee || 0) > 0 && (
            <>
              <br />
              Fee on approval: <b>{fmtMoney(r.fee)}</b>
              <br />
              Total wallet impact: <b>{fmtMoney(Number(r.amount || 0) + Number(r.fee || 0))}</b>
            </>
          )}
        </div>
      ),
      fields: [{ name: 'note', label: 'Note / Reference', type: 'textarea', required: true }],
      confirmText: action === 'approve' ? 'Approve' : 'Reject',
      tone: action === 'approve' ? 'green' : 'red',
    });
    if (!result) return;
    emit('adminResolveWalletRequest', { requestId: r.id, action, note: result.note });
  };
  const reassignWithdrawal = async (r: any) => {
    const result = await ask({
      title: 'No Balance / Reassign Withdrawal',
      description: 'The player request stays pending. The system tries the next active Senior Admin with enough float.',
      summary: (
        <div>
          Player: <b>{r.playerName || r.name || r.playerId}</b>
          <br />
          Amount: <b>{fmtMoney(r.amount)}</b>
          <br />
          Current assignment: <b>{r.assignedWithdrawAdminName || 'Master review'}</b>
        </div>
      ),
      fields: [{ name: 'note', label: 'Reason', type: 'textarea', required: true }],
      confirmText: 'Reassign',
      tone: 'amber',
    });
    if (!result) return;
    emit('adminResolveWalletRequest', { requestId: r.id, action: 'decline', note: result.note });
  };

  const manualCredit = async () => {
    const amt = Number(amount);
    if (!playerQuery.trim() || !Number.isFinite(amt) || amt <= 0 || !note.trim()) return;
    const result = await ask({
      title: 'Confirm Manual Deposit',
      description: 'Master Admin will be notified. Use this only when the player paid but automatic matching did not credit the wallet.',
      summary: (
        <div>
          Player search: <b>{playerQuery}</b>
          <br />
          Credit amount: <b>{fmtMoney(amt)}</b>
          <br />
          Reference: <b>{reference || 'No reference entered'}</b>
        </div>
      ),
      confirmText: 'Credit Player',
      tone: 'green',
    });
    if (!result) return;
    emit('adminManualDeposit', { playerQuery, amount: amt, reference, note });
    setAmount('');
    setReference('');
    setNote('');
  };

  return (
    <>
      <PageTitle title="Requests" subtitle="Resolve deposits/withdrawals and handle rare manual deposit credits." />
      {can(data, 'resolve_requests') && (
        <Card className="mb-5">
          <SectionHeader title="Manual Deposit Credit" icon={CircleDollarSign} />
          <div className="grid gap-3 lg:grid-cols-[1.2fr_.6fr_.8fr_1fr_auto]">
            <Field label="Player" value={playerQuery} onChange={setPlayerQuery} placeholder="Name, phone, HB code, or ID" />
            <Field label="Amount" value={amount} onChange={setAmount} type="number" />
            <Field label="Reference" value={reference} onChange={setReference} />
            <Field label="Proof / Reason" value={note} onChange={setNote} />
            <div className="flex items-end">
              <Button tone="green" onClick={manualCredit}>Credit</Button>
            </div>
          </div>
        </Card>
      )}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <MetricCard label="Pending Deposits" value={deposits.length} sub={fmtMoney(deposits.reduce((s: number, r: any) => s + Number(r.amount || 0), 0))} icon={CreditCard} tone="green" />
        <MetricCard label="Pending Withdrawals" value={withdrawals.length} sub={fmtMoney(withdrawals.reduce((s: number, r: any) => s + Number(r.amount || 0), 0))} icon={CircleDollarSign} tone="red" />
      </div>
      <Table
        headers={['Time', 'Player', 'Type', 'Amount', 'Phone / Account', 'Assigned', 'Status', 'Actions']}
        rows={reqs.slice(0, 220).map((r: any) => [
          fmtTime(r.createdAt),
          <PlayerCell player={r} />,
          <Badge tone={r.type === 'withdraw' ? 'red' : 'green'}>{r.type}</Badge>,
          <div>
            <b>{fmtMoney(r.amount)}</b>
            {r.type === 'withdraw' && Number(r.fee || 0) > 0 && (
              <div className="text-xs font-bold text-amber-200">
                Fee: {fmtMoney(r.fee)} · {r.feeStatus === 'charged' ? 'charged' : 'on approval'}
              </div>
            )}
          </div>,
          r.payoutPhone || r.payerPhone || r.depositAccountNumber || '-',
          r.type === 'withdraw' ? (
            <div>
              <b>{r.assignedWithdrawAdminName || 'Master review'}</b>
              {r.assignmentStatus && <div className="text-xs font-bold text-slate-500">{r.assignmentStatus}</div>}
            </div>
          ) : (r.depositAccountOwnerAdminName || '-'),
          <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
          r.status === 'pending' && can(data, 'resolve_requests') ? (
            <div className="flex flex-wrap gap-2">
              <Button tone="green" className="min-h-8 px-3 text-xs" onClick={() => resolve(r, 'approve')}>Approve</Button>
              <Button tone="red" className="min-h-8 px-3 text-xs" onClick={() => resolve(r, 'reject')}>Reject</Button>
              {r.type === 'withdraw' && <Button tone="amber" className="min-h-8 px-3 text-xs" onClick={() => reassignWithdrawal(r)}>No Balance</Button>}
            </div>
          ) : '-',
        ])}
      />
    </>
  );
}

function GamesPage({ data, emit, ask }: { data: AdminData; emit: EmitFn; ask: AskAction }) {
  const settings = data.gameSettings?.active || {};
  const analyticsRows = data.analytics?.byGame || [];
  const rankMap = new Map(analyticsRows.map((row: any, index: number) => [String(row.game || '').toLowerCase(), { ...row, rank: index + 1 }]));
  const rooms = data.games || [];
  const bingoRooms = rooms.filter((r: any) => r.game === 'bingo');
  const bingoPlayers = bingoRooms.reduce((s: number, r: any) => s + Number(r.playerCount || 0), 0);
  const bingoPot = bingoRooms.reduce((s: number, r: any) => s + Number(r.pot || 0), 0);
  const defs = [
    { key: 'bingo', title: 'Bingo', state: bingoRooms.some((r: any) => ['playing', 'countdown'].includes(r.status)) ? 'Live' : 'Ready', players: bingoPlayers, pot: bingoPot, bets: settings.bingo?.bettingAmounts, rule: `Commission ${Math.round(Number(settings.bingo?.commissionRate || 0) * 100)}%, ${settings.bingo?.minPlayers || '-'}-${settings.bingo?.maxPlayers || '-'} players. Manual check and manual Bingo claim.` },
    { key: 'keno', title: 'Keno', state: 'Instant Draw', players: 0, pot: 0, bets: settings.keno?.bettingAmounts, rule: `Pick up to ${settings.keno?.maxPicks || 20}. Max payout ${fmtMoney(settings.keno?.maxPayoutEtb)}.` },
    { key: 'roulette', title: 'Roulette', state: data.roulette?.status || 'Ready', players: data.roulette?.playerCount || 0, pot: data.roulette?.totalBets || 0, bets: settings.roulette?.bettingAmounts, rule: `Countdown ${settings.roulette?.countdownSeconds || '-'} sec. Commission ${Math.round(Number(settings.roulette?.commissionRate || 0) * 1000) / 10}%.` },
    { key: 'hilo', title: 'Hi-Lo', state: 'Coming soon', players: 0, pot: 0, bets: [], rule: 'Disabled for launch until final review.' },
    { key: 'crash', title: 'Crash', state: 'Coming soon', players: data.crash?.activeBets || 0, pot: data.crash?.totalBets || 0, bets: [], rule: 'Disabled for launch until final risk review.' },
    { key: 'dino', title: 'Dino', state: 'Coming soon', players: 0, pot: 0, bets: [], rule: 'Disabled for launch until final control testing.' },
  ];

  const forceStart = async (bet: number) => {
    const result = await ask({
      title: 'Force Start Bingo Room',
      description: 'This starts the room before the normal countdown completes.',
      summary: <div>Room: <b>{bet} ETB Bingo</b></div>,
      fields: [{ name: 'note', label: 'Reason', type: 'textarea', required: true }],
      confirmText: 'Force Start',
      tone: 'amber',
    });
    if (result) emit('adminForceStart', { bet, note: result.note });
  };
  const cancel = async (bet: number) => {
    const result = await ask({
      title: 'Cancel Bingo Room',
      description: 'This cancels the active room and applies the configured refund/void behavior. The action is audited.',
      summary: <div>Room: <b>{bet} ETB Bingo</b></div>,
      fields: [{ name: 'note', label: 'Reason', type: 'textarea', required: true }],
      confirmText: 'Cancel Room',
      tone: 'red',
    });
    if (result) emit('adminCancelGame', { bet, note: result.note });
  };

  const rouletteManualSpin = async () => {
    const result = await ask({
      title: 'Manual Spin',
      description: 'Manually trigger the roulette spin. Only works during the betting phase.',
      fields: [{ name: 'note', label: 'Reason', type: 'textarea', required: true }],
      confirmText: 'Spin Now',
      tone: 'amber',
    });
    if (result) emit('adminRouletteSpin', { note: result.note });
  };
  const rouletteForceSpin = async () => {
    const result = await ask({
      title: 'Force Spin Immediately',
      description: 'Skip the remaining countdown and spin immediately. Only works during the betting phase.',
      fields: [{ name: 'note', label: 'Reason', type: 'textarea', required: true }],
      confirmText: 'Force Spin',
      tone: 'red',
    });
    if (result) emit('adminRouletteForceSpin', { note: result.note });
  };
  const rouletteSkipResult = async () => {
    const result = await ask({
      title: 'Skip to Next Round',
      description: 'Skip the result display and immediately start a new betting round.',
      fields: [{ name: 'note', label: 'Reason', type: 'textarea', required: true }],
      confirmText: 'Skip Result',
      tone: 'green',
    });
    if (result) emit('adminRouletteSkipResult', { note: result.note });
  };
  const rouletteSetNumber = async () => {
    const result = await ask({
      title: 'Set Winning Number',
      description: 'Set a specific winning number (0–36) for the next spin. Only works during betting phase. This action is audited.',
      fields: [
        { name: 'number', label: 'Winning Number (0–36)', type: 'number', placeholder: 'e.g. 7', required: true },
        { name: 'note', label: 'Reason', type: 'textarea', required: true },
      ],
      confirmText: 'Set & Spin',
      tone: 'amber',
    });
    if (result) emit('adminRouletteSetNumber', { number: result.number, note: result.note });
  };

  return (
    <>
      <PageTitle title="Games" subtitle="Readable game cards with live state, rules, risk, and allowed controls." />
      <div className="grid gap-5 lg:grid-cols-2">
        {defs.map((g) => {
          const stats: any = rankMap.get(g.key) || {};
          return (
            <Card key={g.key} className="overflow-hidden p-0">
              <div className="bg-gradient-to-br from-red-700 via-red-900 to-slate-950 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-black text-white">{g.title}</h2>
                    <p className="mt-1 text-sm font-bold text-yellow-100/70">{g.rule}</p>
                  </div>
                  <Badge tone={g.state === 'Coming soon' ? 'amber' : 'green'}>{g.state}</Badge>
                </div>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <MetricMini label="Active players" value={g.players} />
                <MetricMini label="Current stakes" value={fmtMoney(g.pot)} />
                <MetricMini label="Games played" value={stats.totalGamesPlayed || 0} />
                <MetricMini label="House net" value={fmtMoney(stats.netHouseProfit)} good={Number(stats.netHouseProfit || 0) >= 0} />
              </div>
              <div className="border-t border-slate-800 p-5">
                <div className="mb-3 flex flex-wrap gap-2">
                  {(g.bets || []).length ? (g.bets || []).map((b: any) => <Badge key={b} tone="amber">{b} ETB</Badge>) : <Badge>Not open</Badge>}
                </div>
                {g.key === 'bingo' && (
                  <div className="grid gap-3">
                    {bingoRooms.filter((r: any) => ['countdown', 'playing', 'paused'].includes(r.status)).map((room: any) => (
                      <div key={room.bet} className="rounded-2xl border border-slate-700 bg-slate-950/40 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-black text-white">{room.bet} ETB room | {room.playerCount} players | {room.calledCount || 0}/75</div>
                          <Badge tone={statusTone(room.status)}>{room.status}</Badge>
                        </div>
                        {can(data, 'game_control') && (
                          <div className="mt-3 flex gap-2">
                            {room.status === 'countdown' && <Button tone="amber" className="min-h-8 px-3 text-xs" onClick={() => forceStart(room.bet)}>Force Start</Button>}
                            <Button tone="red" className="min-h-8 px-3 text-xs" onClick={() => cancel(room.bet)}>Cancel</Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {g.key === 'roulette' && can(data, 'game_control') && (
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="font-black text-white">Roulette Controls</div>
                      <Badge tone={statusTone(data.roulette?.status || '')}>{data.roulette?.status || 'unknown'}</Badge>
                    </div>
                    <div className="mb-2 text-xs text-slate-400">
                      Round #{data.roulette?.roundNumber || 0} · {data.roulette?.playerCount || 0} players · {fmtMoney(data.roulette?.totalBets)} in bets
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button tone="amber" className="min-h-8 px-3 text-xs" onClick={rouletteManualSpin}>Manual Spin</Button>
                      <Button tone="red" className="min-h-8 px-3 text-xs" onClick={rouletteForceSpin}>Force Spin Now</Button>
                      <Button tone="green" className="min-h-8 px-3 text-xs" onClick={rouletteSkipResult}>Skip Result</Button>
                      <Button tone="amber" className="min-h-8 px-3 text-xs" onClick={rouletteSetNumber}>Set Number</Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function MetricMini({ label, value, good }: { label: string; value: any; good?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/36 p-4">
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx('mt-1 text-lg font-black', good === undefined ? 'text-white' : good ? 'text-emerald-300' : 'text-red-300')}>{value}</div>
    </div>
  );
}

function FinancePage({ data, emit, ask }: { data: AdminData; emit: EmitFn; ask: AskAction }) {
  const labels = data.finance?.accountLabels || {};
  const rawAccounts = data.company?.accounts || {};
  const masterFinanceView = can(data, 'audit_all');
  const accounts = masterFinanceView
    ? Object.fromEntries(Object.keys(labels).map((key) => [key, Number(rawAccounts[key] || 0)]))
    : rawAccounts;
  const preferredOrder = [
    'playerLiability',
    'withdrawals',
    'gameEscrow',
    'bingoPrizeVault',
    'kenoPrizeVault',
    'kenoHouseWinVault',
    'roulettePrizeVault',
    'rouletteHouseWinVault',
    'commission',
    'withdrawalFeeVault',
    'promotion',
    'operating',
    'crashVault',
    'prizeVault',
  ];
  const keys = [
    ...preferredOrder.filter((key) => Object.prototype.hasOwnProperty.call(accounts, key)),
    ...Object.keys(accounts).filter((key) => !preferredOrder.includes(key)),
  ];
  const [from, setFrom] = useState(keys[0] || '');
  const [to, setTo] = useState(keys[1] || keys[0] || '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [injectAccount, setInjectAccount] = useState('promotion');
  const [injectAmount, setInjectAmount] = useState('');
  const [injectNote, setInjectNote] = useState('');

  useEffect(() => {
    if (!from && keys[0]) setFrom(keys[0]);
    if (!to && keys[1]) setTo(keys[1]);
  }, [keys.join('|')]);

  const transfer = async () => {
    const amt = Number(amount);
    if (!from || !to || from === to || !Number.isFinite(amt) || amt <= 0 || !note.trim()) return;
    const result = await ask({
      title: 'Confirm Fund Transfer',
      description: 'This moves money between internal vault accounts and will be written to the ledger.',
      summary: (
        <div>
          From: <b>{labels[from] || from}</b>
          <br />
          To: <b>{labels[to] || to}</b>
          <br />
          Amount: <b>{fmtMoney(amt)}</b>
        </div>
      ),
      confirmText: 'Transfer Funds',
      tone: 'amber',
    });
    if (!result) return;
    emit('adminTransferFunds', { fromAccount: from, toAccount: to, amount: amt, note });
  };
  const inject = async () => {
    const amt = Number(injectAmount);
    if (!injectAccount || !Number.isFinite(amt) || amt <= 0 || !injectNote.trim()) return;
    const result = await ask({
      title: 'Confirm Capital Injection',
      description: 'This creates/adds system funds for the selected vault. Use a clear source/reason.',
      summary: (
        <div>
          Account: <b>{labels[injectAccount] || injectAccount}</b>
          <br />
          Amount: <b>{fmtMoney(amt)}</b>
        </div>
      ),
      confirmText: 'Inject Funds',
      tone: 'green',
    });
    if (!result) return;
    emit('adminAddFunds', { account: injectAccount, amount: amt, note: injectNote });
  };
  const dividend = async () => {
    const result = await ask({
      title: 'Dividend Withdrawal',
      description: 'Master Admin only. This removes profit from active system liquidity and records it permanently.',
      fields: [
        { name: 'account', label: 'Source Account', type: 'select', value: keys.includes('commission') ? 'commission' : keys[0] || '', required: true, options: keys.map((k) => ({ value: k, label: labels[k] || k })) },
        { name: 'amount', label: 'Amount', type: 'number', required: true },
        { name: 'note', label: 'Reason', type: 'textarea', required: true },
      ],
      confirmText: 'Withdraw Dividend',
      tone: 'red',
    });
    if (!result) return;
    const amt = Number(result.amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    emit('adminDividendWithdraw', { account: result.account, amount: amt, note: result.note });
  };

  return (
    <>
      <PageTitle title="Finance" subtitle="Role-filtered vault view, transfers, injections, and transaction history." />
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {keys.map((k) => (
          <MetricCard key={k} label={labels[k] || human(k)} value={fmtMoney(accounts[k])} icon={Wallet} tone={k.includes('commission') ? 'gold' : k.includes('Prize') || k.includes('Vault') ? 'green' : 'blue'} />
        ))}
      </div>
      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <SectionHeader title="Transfer Funds" icon={Wallet} />
          <div className="grid gap-3">
            <SelectField label="From" value={from} onChange={setFrom} options={keys.map((k) => ({ value: k, label: labels[k] || k }))} />
            <SelectField label="To" value={to} onChange={setTo} options={keys.map((k) => ({ value: k, label: labels[k] || k }))} />
            <Field label="Amount" value={amount} onChange={setAmount} type="number" />
            <Field label="Reason" value={note} onChange={setNote} />
            <Button tone="primary" onClick={transfer}>Transfer</Button>
          </div>
        </Card>
        <Card>
          <SectionHeader title="Capital / Promo Injection" icon={CircleDollarSign} />
          <div className="grid gap-3">
            <SelectField label="Account" value={injectAccount} onChange={setInjectAccount} options={keys.map((k) => ({ value: k, label: labels[k] || k }))} />
            <Field label="Amount" value={injectAmount} onChange={setInjectAmount} type="number" />
            <Field label="Reason / Source" value={injectNote} onChange={setInjectNote} />
            <Button tone="green" onClick={inject}>Inject Funds</Button>
            {can(data, 'audit_all') && <Button tone="red" onClick={dividend}>Dividend Withdrawal</Button>}
          </div>
        </Card>
      </div>
      <div className="mb-5">
        <StaffFloatSummary data={data} />
      </div>
      <div className="mb-5">
        <AdminCashStatement data={data} />
      </div>
      <Card>
        <SectionHeader title="Transactions" icon={History} />
        <Table
          headers={['Time', 'Type', 'Amount', 'Description']}
          rows={(data.transactions || []).slice(0, 160).map((t: any) => [fmtTime(t.time), <Badge tone={statusTone(t.type)}>{t.type}</Badge>, fmtMoney(t.amount), t.desc || t.description || '-'])}
        />
      </Card>
    </>
  );
}

function HistoryPage({ data }: { data: AdminData }) {
  const [scope, setScope] = useState('audit');
  const audit = data.auditEvents || [];
  const history = data.gameHistory || [];
  const admin = currentAdmin(data);
  const myActivity = audit.filter((a: any) => a.actorId === admin?.id);
  const exportAudit = () => {
    const rows = audit.map((a: any) => ({
      Time: a.time,
      Category: a.category,
      Event: a.event,
      Actor: a.actorName || a.admin || a.actorType,
      Player: a.playerName || a.playerId || '',
      Game: a.game || '',
      Amount: a.amount || '',
      Status: a.status || '',
      Details: formatDetails(a.details),
    }));
    const headers = Object.keys(rows[0] || { Time: '', Event: '', Details: '' });
    const html = `<html><body><table border="1"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r: any) => `<tr>${headers.map((h) => `<td>${String(r[h] ?? '').replace(/</g, '&lt;')}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `habeshabingo-audit-${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageTitle title="History & Audit" subtitle="Game receipts, audit logs, and your admin activity." action={<Button tone="green" onClick={exportAudit}><Download size={16} /> Excel</Button>} />
      <Card className="mb-5">
        <div className="flex flex-wrap gap-2">
          {[
            ['audit', 'Live Audit'],
            ['games', 'Game History'],
            ['me', 'My Activity'],
          ].map(([key, label]) => (
            <Button key={key} tone={scope === key ? 'primary' : 'ghost'} onClick={() => setScope(key)}>
              {label}
            </Button>
          ))}
        </div>
      </Card>
      {scope === 'audit' && (
        <Table
          headers={['Time', 'Category', 'Event', 'Actor', 'Player', 'Game', 'Amount', 'Status', 'Details']}
          rows={audit.slice(0, 300).map((a: any) => [fmtTime(a.time), a.category || '-', <Badge tone="blue">{a.event || a.action}</Badge>, a.actorName || a.admin || a.actorType || '-', a.playerName || a.playerId || '-', a.game || '-', a.amount ? fmtMoney(a.amount) : '-', a.status || '-', <span className="whitespace-normal">{formatDetails(a.details)}</span>])}
        />
      )}
      {scope === 'games' && (
        <Table
          headers={['Time', 'Receipt', 'Game', 'Player', 'Bet', 'Payout', 'Profit', 'Status']}
          rows={history.slice(0, 260).map((r: any) => [fmtTime(r.createdAt), r.id || r.receiptId || '-', r.game || '-', r.playerName || r.playerId || '-', fmtMoney(r.bet), fmtMoney(r.payout), fmtMoney(r.houseProfit ?? r.profit), <Badge tone={statusTone(r.status)}>{r.status || (Number(r.payout || 0) > 0 ? 'win' : 'loss')}</Badge>])}
        />
      )}
      {scope === 'me' && (
        <Table
          headers={['Time', 'Event', 'Player', 'Game', 'Amount', 'Details']}
          rows={myActivity.slice(0, 200).map((a: any) => [fmtTime(a.time), <Badge tone="purple">{a.event || a.action}</Badge>, a.playerName || a.playerId || '-', a.game || '-', a.amount ? fmtMoney(a.amount) : '-', <span className="whitespace-normal">{formatDetails(a.details)}</span>])}
        />
      )}
    </>
  );
}

function AccountPage({ data, emit }: { data: AdminData; emit: (event: string, payload?: any) => void }) {
  const admin = currentAdmin(data) || {};
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [chatId, setChatId] = useState(admin.telegramChatId || '');
  const [telegramUsername, setTelegramUsername] = useState(admin.telegramUsername || '');

  useEffect(() => {
    setChatId(admin.telegramChatId || '');
    setTelegramUsername(admin.telegramUsername || '');
  }, [admin.telegramChatId, admin.telegramUsername]);

  const changePassword = () => {
    if (currentPassword.length < 4 || newPassword.length < 4) return;
    emit('adminChangeOwnPassword', { currentPassword, newPassword });
    setCurrentPassword('');
    setNewPassword('');
  };

  return (
    <>
      <PageTitle title="My Account" subtitle="Password, Telegram alerts, and profile identity." />
      <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
        <div className="grid gap-4">
          <MetricCard label="Admin Name" value={admin.name || '-'} sub={roleLabel(data)} icon={Shield} tone="gold" />
          <MetricCard label="Username" value={admin.username || '-'} sub="Used for login" icon={UserCog} tone="blue" />
          <MetricCard label="Telegram" value={admin.telegramChatId ? 'Connected' : 'Not set'} sub={admin.telegramUsername || admin.telegramChatId || 'Connect for alerts'} icon={Bell} tone={admin.telegramChatId ? 'green' : 'red'} />
          {admin.referralLink && (
            <Card>
              <SectionHeader title="My Referral Link" icon={Link2} />
              <p className="break-all rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm font-black text-amber-100">{admin.referralLink}</p>
              <Button className="mt-3" tone="primary" onClick={() => copyToClipboard(admin.referralLink)}>Copy Link</Button>
            </Card>
          )}
        </div>
        <div className="grid gap-5">
          <Card>
            <SectionHeader title="Change Password" icon={LockKeyhole} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Current Password" value={currentPassword} onChange={setCurrentPassword} type="password" />
              <Field label="New Password" value={newPassword} onChange={setNewPassword} type="password" />
            </div>
            <Button className="mt-3" tone="primary" onClick={changePassword}>Save Password</Button>
          </Card>
          <Card>
            <SectionHeader title="Telegram Notifications" icon={Bell} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Telegram Chat ID" value={chatId} onChange={setChatId} />
              <Field label="Telegram Username" value={telegramUsername} onChange={setTelegramUsername} />
            </div>
            <Button className="mt-3" tone="green" onClick={() => emit('adminUpdateOwnTelegram', { chatId, username: telegramUsername })}>Connect Telegram</Button>
          </Card>
        </div>
      </div>
      <div className="mt-5">
        <AdminCashStatement data={data} compact />
      </div>
    </>
  );
}

function AdminsPage({ data, emit, ask }: { data: AdminData; emit: EmitFn; ask: AskAction }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('senior');
  const [withdrawalFloat, setWithdrawalFloat] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramUsername, setTelegramUsername] = useState('');
  const [account1, setAccount1] = useState('');
  const [receiver1, setReceiver1] = useState('');
  const [account2, setAccount2] = useState('');
  const [receiver2, setReceiver2] = useState('');
  const [account3, setAccount3] = useState('');
  const [receiver3, setReceiver3] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const username = generatedAdminUsername(name, phone);
  const create = async () => {
    if (!name.trim() || !phone.trim() || !password.trim()) return;
    const depositAccounts = [
      { level: 1, accountNumber: account1.trim(), receiverName: receiver1.trim(), label: `${name.trim()} deposit 1` },
      { level: 2, accountNumber: account2.trim(), receiverName: receiver2.trim(), label: `${name.trim()} deposit 2` },
      { level: 3, accountNumber: account3.trim(), receiverName: receiver3.trim(), label: `${name.trim()} deposit 3` },
    ].filter((a) => a.accountNumber);
    const result = await ask({
      title: 'Create Admin Account',
      description: 'The new admin must change this temporary password on first login.',
      summary: (
        <div>
          Name: <b>{name}</b>
          <br />
          Username: <b>{username || 'Will be generated by server'}</b>
          <br />
          Role: <b>{role}</b>
          <br />
          Deposit accounts: <b>{depositAccounts.length}</b>
        </div>
      ),
      confirmText: 'Create Admin',
      tone: 'green',
    });
    if (!result) return;
    emit('adminCreateUser', { name, phone, password, role, withdrawalFloatBalance: Number(withdrawalFloat || 0), telegramChatId, telegramUsername, depositAccounts });
    setName('');
    setPhone('');
    setPassword('');
    setWithdrawalFloat('');
    setTelegramChatId('');
    setTelegramUsername('');
    setAccount1('');
    setReceiver1('');
    setAccount2('');
    setReceiver2('');
    setAccount3('');
    setReceiver3('');
  };
  const reset = async (a: any) => {
    const result = await ask({
      title: 'Reset Admin Password',
      description: 'The admin will be forced to change this temporary password at next login.',
      summary: <div>Admin: <b>{a.name}</b></div>,
      fields: [
        { name: 'password', label: 'Temporary Password', type: 'password', required: true },
        { name: 'reason', label: 'Reason', type: 'textarea', required: true },
      ],
      confirmText: 'Reset Password',
      tone: 'amber',
    });
    if (result) emit('adminResetUserPassword', { adminId: a.id, password: result.password, reason: result.reason });
  };
  const setStatus = async (a: any, active: boolean) => {
    const result = await ask({
      title: `${active ? 'Enable' : 'Disable'} Admin`,
      description: active ? 'This admin will be able to log in again.' : 'This admin will lose dashboard access.',
      summary: <div>Admin: <b>{a.name}</b></div>,
      fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }],
      confirmText: active ? 'Enable' : 'Disable',
      tone: active ? 'green' : 'red',
    });
    if (result) emit('adminSetUserStatus', { adminId: a.id, active, reason: result.reason });
  };
  const setFreePlay = async (a: any, active: boolean) => {
    const result = await ask({
      title: `${active ? 'Enable' : 'Disable'} Free Testing`,
      description: active
        ? 'This admin can test Keno and Roulette without changing wallet balances, vaults, commission, or game history. Bingo remains real-money only.'
        : 'This admin will return to normal wallet-based play for Keno and Roulette.',
      summary: (
        <div>
          Admin: <b>{a.name}</b>
          <br />
          Phone match: <b>{a.phone || '-'}</b>
        </div>
      ),
      fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }],
      confirmText: active ? 'Enable Free Play' : 'Disable Free Play',
      tone: active ? 'green' : 'amber',
    });
    if (result) emit('adminSetUserFreePlay', { adminId: a.id, active, reason: result.reason });
  };
  return (
    <>
      <PageTitle title="Admin Users" subtitle="Create, pause, and reset staff accounts. Master actions are audited." />
      <div className="mb-5">
        <StaffFloatSummary data={data} />
      </div>
      <Card className="mb-5">
        <SectionHeader title="Create Admin" icon={UserCog} />
        <div className="grid gap-3 lg:grid-cols-6">
          <Field label="Full Name" value={name} onChange={setName} />
          <Field label="Phone" value={phone} onChange={setPhone} />
          <Field label="Temp Password" value={password} onChange={setPassword} type="password" />
          <SelectField label="Role" value={role} onChange={setRole} options={[{ value: 'senior', label: 'Senior Admin' }, { value: 'support', label: 'Support Admin' }, { value: 'auditor', label: 'Read-only Auditor' }]} />
          <Field label="Withdraw Float" value={withdrawalFloat} onChange={setWithdrawalFloat} type="number" />
          <div className="flex items-end"><Button tone="primary" onClick={create}>Create</Button></div>
        </div>
        <div className="mt-4 rounded-2xl border border-sky-400/15 bg-sky-500/5 p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-black text-white"><Bell size={16} className="text-sky-200" /> Telegram Notifications</div>
          <p className="mb-3 text-xs font-semibold text-slate-400">Optional but recommended. Use the admin-only notification bot chat ID so alerts can go directly to this staff member.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Telegram Chat ID" value={telegramChatId} onChange={setTelegramChatId} />
            <Field label="Telegram Username" value={telegramUsername} onChange={setTelegramUsername} />
          </div>
        </div>
        {role === 'senior' && (
          <div className="mt-4 rounded-2xl border border-slate-700/70 bg-slate-950/35 p-3">
            <div className="mb-3 text-sm font-black text-white">Senior Admin Deposit Accounts</div>
            <p className="mb-3 text-xs font-semibold text-slate-400">Only the Telebirr number is required. If receiver name or label is left blank, the system will auto-fill it from the admin name.</p>
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="grid gap-2">
                <Field label="Account 1 Number" value={account1} onChange={setAccount1} />
                <Field label="Account 1 Receiver" value={receiver1} onChange={setReceiver1} />
              </div>
              <div className="grid gap-2">
                <Field label="Account 2 Number" value={account2} onChange={setAccount2} />
                <Field label="Account 2 Receiver" value={receiver2} onChange={setReceiver2} />
              </div>
              <div className="grid gap-2">
                <Field label="Account 3 Number" value={account3} onChange={setAccount3} />
                <Field label="Account 3 Receiver" value={receiver3} onChange={setReceiver3} />
              </div>
            </div>
          </div>
        )}
        <p className="mt-3 text-sm font-semibold text-slate-400">Generated username: <span className="text-yellow-200">{username || '-'}</span></p>
      </Card>
      <Table
        headers={['Name', 'Username / Phone', 'Referral Link', 'Role', 'Float', 'Telegram', 'Status', 'Free Play', 'Last Login', 'Actions']}
        rows={(data.adminUsers || []).map((a: any) => [
          <b>{a.name}</b>,
          <div><div>{a.username}</div><div className="text-xs text-slate-500">{a.phone}</div></div>,
          a.referralLink ? (
            <button className="max-w-[220px] truncate text-left text-xs font-black text-amber-200 underline decoration-amber-300/30" onClick={() => copyToClipboard(a.referralLink)}>{a.referralCode}</button>
          ) : '-',
          a.roleLabel || a.role,
          a.role === 'senior' ? <b>{fmtMoney(a.withdrawalFloatBalance || 0)}</b> : '-',
          a.telegramChatId ? <div><Badge tone="green">Connected</Badge><div className="mt-1 text-xs text-slate-500">{a.telegramUsername ? `@${a.telegramUsername}` : a.telegramChatId}</div></div> : <Badge tone="amber">Not set</Badge>,
          <Badge tone={a.active ? 'green' : 'red'}>{a.active ? 'Active' : 'Disabled'}</Badge>,
          <Badge tone={a.freePlayActive ? 'purple' : 'slate'}>{a.freePlayActive ? 'Enabled' : 'Off'}</Badge>,
          fmtTime(a.lastLoginAt),
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-8 px-3 text-xs" onClick={() => setEditing(a)}>Edit</Button>
            <Button className="min-h-8 px-3 text-xs" onClick={() => reset(a)}>Reset PW</Button>
            <Button tone={a.freePlayActive ? 'amber' : 'green'} className="min-h-8 px-3 text-xs" onClick={() => setFreePlay(a, !a.freePlayActive)}>{a.freePlayActive ? 'Free Off' : 'Free On'}</Button>
            {a.role !== 'master' && <Button tone={a.active ? 'red' : 'green'} className="min-h-8 px-3 text-xs" onClick={() => setStatus(a, !a.active)}>{a.active ? 'Disable' : 'Enable'}</Button>}
          </div>,
        ])}
      />
      {editing && <AdminEditModal admin={editing} data={data} emit={emit} ask={ask} onClose={() => setEditing(null)} />}
    </>
  );
}

function generatedAdminUsername(name: string, phone: string) {
  const first = String(name || '').trim().split(/\s+/)[0]?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || '';
  const last2 = String(phone || '').replace(/\D/g, '').slice(-2);
  return first && last2 ? `${first}${last2}` : '';
}

function AdminEditModal({ admin, data, emit, ask, onClose }: { admin: any; data: AdminData; emit: EmitFn; ask: AskAction; onClose: () => void }) {
  const owned = (data.depositAccounts || []).filter((a: any) => a.status !== 'deleted' && a.ownerAdminId === admin.id);
  const [name, setName] = useState(admin.name || '');
  const [phone, setPhone] = useState(admin.phone || '');
  const [role, setRole] = useState(admin.role || 'senior');
  const [active, setActive] = useState(admin.active !== false ? 'active' : 'disabled');
  const [withdrawalFloat, setWithdrawalFloat] = useState(String(admin.withdrawalFloatBalance || 0));
  const [telegramChatId, setTelegramChatId] = useState(admin.telegramChatId || '');
  const [telegramUsername, setTelegramUsername] = useState(admin.telegramUsername || '');
  const [acc1, setAcc1] = useState(owned[0]?.accountNumber || '');
  const [recv1, setRecv1] = useState(owned[0]?.receiverName || '');
  const [acc2, setAcc2] = useState(owned[1]?.accountNumber || '');
  const [recv2, setRecv2] = useState(owned[1]?.receiverName || '');
  const [acc3, setAcc3] = useState(owned[2]?.accountNumber || '');
  const [recv3, setRecv3] = useState(owned[2]?.receiverName || '');

  const save = async () => {
    const depositAccounts = [
      { id: owned[0]?.id, level: 1, accountNumber: acc1.trim(), receiverName: recv1.trim(), label: `${name.trim()} deposit 1`, status: owned[0]?.status || 'active' },
      { id: owned[1]?.id, level: 2, accountNumber: acc2.trim(), receiverName: recv2.trim(), label: `${name.trim()} deposit 2`, status: owned[1]?.status || 'active' },
      { id: owned[2]?.id, level: 3, accountNumber: acc3.trim(), receiverName: recv3.trim(), label: `${name.trim()} deposit 3`, status: owned[2]?.status || 'active' },
    ].filter((a) => a.id || a.accountNumber);
    const result = await ask({
      title: 'Save Admin Changes',
      description: 'Changes to staff access and deposit accounts are audited.',
      summary: (
        <div>
          Admin: <b>{name}</b>
          <br />
          Role: <b>{role}</b>
          <br />
          Status: <b>{active}</b>
          <br />
          Deposit accounts: <b>{depositAccounts.filter((a) => a.accountNumber).length}</b>
        </div>
      ),
      fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }],
      confirmText: 'Save Admin',
      tone: 'amber',
    });
    if (!result) return;
    emit('adminUpdateUser', { adminId: admin.id, name, phone, role, active: active === 'active', withdrawalFloatBalance: Number(withdrawalFloat || 0), telegramChatId, telegramUsername, depositAccounts, reason: result.reason });
    onClose();
  };

  return (
    <Modal title={`Edit Admin: ${admin.name}`} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full Name" value={name} onChange={setName} />
          <Field label="Phone" value={phone} onChange={setPhone} />
          <SelectField label="Role" value={role} onChange={setRole} options={[{ value: 'senior', label: 'Senior Admin' }, { value: 'support', label: 'Support Admin' }, { value: 'auditor', label: 'Read-only Auditor' }, ...(admin.role === 'master' ? [{ value: 'master', label: 'Master Admin' }] : [])]} />
          <SelectField label="Status" value={active} onChange={setActive} options={[{ value: 'active', label: 'Active' }, { value: 'disabled', label: 'Disabled' }]} />
          {role === 'senior' && <Field label="Withdrawal Float" value={withdrawalFloat} onChange={setWithdrawalFloat} type="number" />}
        </div>
        <div className="rounded-2xl border border-sky-400/15 bg-sky-500/5 p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-black text-white"><Bell size={16} className="text-sky-200" /> Telegram Notifications</div>
          <p className="mb-3 text-xs font-semibold text-slate-400">Set or update the chat ID used for direct admin alerts. Username is optional and only helps humans recognize the account.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Telegram Chat ID" value={telegramChatId} onChange={setTelegramChatId} />
            <Field label="Telegram Username" value={telegramUsername} onChange={setTelegramUsername} />
          </div>
        </div>
        {role === 'senior' && (
          <div className="rounded-2xl border border-slate-700 bg-slate-950/35 p-3">
            <div className="mb-3 text-sm font-black text-white">Assigned Deposit Accounts</div>
            <p className="mb-3 text-xs font-semibold text-slate-400">Only the Telebirr number is required. Receiver name and label can be left blank.</p>
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="grid gap-2">
                <Field label="Account 1 Number" value={acc1} onChange={setAcc1} />
                <Field label="Account 1 Receiver" value={recv1} onChange={setRecv1} />
              </div>
              <div className="grid gap-2">
                <Field label="Account 2 Number" value={acc2} onChange={setAcc2} />
                <Field label="Account 2 Receiver" value={recv2} onChange={setRecv2} />
              </div>
              <div className="grid gap-2">
                <Field label="Account 3 Number" value={acc3} onChange={setAcc3} />
                <Field label="Account 3 Receiver" value={recv3} onChange={setRecv3} />
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button tone="dark" onClick={onClose}>Cancel</Button>
          <Button tone="primary" onClick={save}>Save Changes</Button>
        </div>
      </div>
    </Modal>
  );
}

function listToText(value: any) {
  return Array.isArray(value) ? value.join(', ') : String(value || '');
}

function parseNumberList(value: string) {
  return value.split(/[,\s]+/).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
}

function payoutToLines(table: any) {
  return Object.entries(table || {})
    .flatMap(([pick, row]: [string, any]) =>
      Object.entries(row || {}).map(([hit, mult]) => `${pick} picks, ${hit} hits = ${mult}x`),
    )
    .join('\n');
}

function linesToPayout(value: string) {
  const table: Record<string, Record<string, number>> = {};
  value.split(/\n+/).forEach((line) => {
    const nums = line.match(/\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 3) return;
    const pick = String(Number(nums[0]));
    const hit = String(Number(nums[1]));
    const mult = Number(nums[2]);
    if (!Number.isFinite(mult) || mult <= 0) return;
    if (!table[pick]) table[pick] = {};
    table[pick][hit] = Math.round(mult * 100) / 100;
  });
  return table;
}

function numberValue(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function SettingsPage({ data, emit, ask }: { data: AdminData; emit: EmitFn; ask: AskAction }) {
  const policies = data.policies || {};
  const telegram = data.telegramSettings || {};
  const active = data.gameSettings?.active || {};
  const bingo = active.bingo || {};
  const keno = active.keno || {};
  const roulette = active.roulette || {};
  const wallet = active.wallet || {};

  const [policyTitle, setPolicyTitle] = useState(policies.title || '');
  const [policyBody, setPolicyBody] = useState(policies.body || '');
  const [policyNote, setPolicyNote] = useState('');
  const [botToken, setBotToken] = useState('');
  const [adminBotToken, setAdminBotToken] = useState('');
  const [botUsername, setBotUsername] = useState(telegram.botUsername || '');
  const [chatIds, setChatIds] = useState((telegram.adminChatIds || []).join(', '));
  const [tgNote, setTgNote] = useState('');

  const [bingoBets, setBingoBets] = useState(listToText(bingo.bettingAmounts));
  const [bingoMinPlayers, setBingoMinPlayers] = useState(String(bingo.minPlayers || ''));
  const [bingoMaxPlayers, setBingoMaxPlayers] = useState(String(bingo.maxPlayers || ''));
  const [bingoCountdown, setBingoCountdown] = useState(String(bingo.countdownSeconds || ''));
  const [bingoDrawMs, setBingoDrawMs] = useState(String(bingo.drawIntervalMs || ''));
  const [bingoWinnerShare, setBingoWinnerShare] = useState(String(bingo.winnerShare || ''));
  const [bingoCommission, setBingoCommission] = useState(String(bingo.commissionRate || ''));
  const [bingoFirstPenalty, setBingoFirstPenalty] = useState(String(bingo.falseClaimFirstPenaltySeconds || ''));
  const [bingoRepeatPenalty, setBingoRepeatPenalty] = useState(String(bingo.falseClaimRepeatPenaltySeconds || ''));
  const [bingoNote, setBingoNote] = useState('');

  const [kenoBets, setKenoBets] = useState(listToText(keno.bettingAmounts));
  const [kenoMinBet, setKenoMinBet] = useState(String(keno.minBet || ''));
  const [kenoMaxBet, setKenoMaxBet] = useState(String(keno.maxBet || ''));
  const [kenoMaxPicks, setKenoMaxPicks] = useState(String(keno.maxPicks || ''));
  const [kenoMaxPayout, setKenoMaxPayout] = useState(String(keno.maxPayoutEtb || ''));
  const [kenoMaxMultiplier, setKenoMaxMultiplier] = useState(String(keno.maxMultiplier || ''));
  const [kenoPayouts, setKenoPayouts] = useState(payoutToLines(keno.payoutTable));
  const [kenoNote, setKenoNote] = useState('');

  const [rouletteBets, setRouletteBets] = useState(listToText(roulette.bettingAmounts));
  const [rouletteCountdown, setRouletteCountdown] = useState(String(roulette.countdownSeconds || ''));
  const [rouletteResultSeconds, setRouletteResultSeconds] = useState(String(roulette.resultDisplaySeconds || ''));
  const [rouletteMinBet, setRouletteMinBet] = useState(String(roulette.minBet || ''));
  const [rouletteMaxBet, setRouletteMaxBet] = useState(String(roulette.maxBet || ''));
  const [rouletteMaxPlayerPayout, setRouletteMaxPlayerPayout] = useState(String(roulette.maxPlayerPayout || ''));
  const [rouletteMaxRoundPayout, setRouletteMaxRoundPayout] = useState(String(roulette.maxRoundPayout || ''));
  const [rouletteCommission, setRouletteCommission] = useState(String(roulette.commissionRate || ''));
  const [rouletteNote, setRouletteNote] = useState('');

  const [walletMinWithdraw, setWalletMinWithdraw] = useState(String(wallet.minWithdrawEtb || ''));
  const [walletMaxWithdraw, setWalletMaxWithdraw] = useState(String(wallet.maxWithdrawEtb || ''));
  const [walletDailyWithdraw, setWalletDailyWithdraw] = useState(String(wallet.dailyWithdrawLimitEtb || ''));
  const [walletSignupPromoEnabled, setWalletSignupPromoEnabled] = useState(wallet.signupPromoEnabled === false ? 'paused' : 'active');
  const [walletSignupPromoAmount, setWalletSignupPromoAmount] = useState(String(wallet.signupPromoAmount ?? 50));
  const [walletFeeEnabled, setWalletFeeEnabled] = useState(wallet.withdrawalFeeEnabled === true ? 'active' : 'paused');
  const [walletFeeRate, setWalletFeeRate] = useState(String(wallet.withdrawalFeeRate || ''));
  const [walletFeeFlat, setWalletFeeFlat] = useState(String(wallet.withdrawalFeeFlat || ''));
  const [walletNote, setWalletNote] = useState('');

  useEffect(() => {
    setPolicyTitle(policies.title || '');
    setPolicyBody(policies.body || '');
    setChatIds((telegram.adminChatIds || []).join(', '));
  }, [policies.title, policies.body, JSON.stringify(telegram.adminChatIds || [])]);

  useEffect(() => {
    setBingoBets(listToText(bingo.bettingAmounts));
    setBingoMinPlayers(String(bingo.minPlayers || ''));
    setBingoMaxPlayers(String(bingo.maxPlayers || ''));
    setBingoCountdown(String(bingo.countdownSeconds || ''));
    setBingoDrawMs(String(bingo.drawIntervalMs || ''));
    setBingoWinnerShare(String(bingo.winnerShare || ''));
    setBingoCommission(String(bingo.commissionRate || ''));
    setBingoFirstPenalty(String(bingo.falseClaimFirstPenaltySeconds || ''));
    setBingoRepeatPenalty(String(bingo.falseClaimRepeatPenaltySeconds || ''));
    setKenoBets(listToText(keno.bettingAmounts));
    setKenoMinBet(String(keno.minBet || ''));
    setKenoMaxBet(String(keno.maxBet || ''));
    setKenoMaxPicks(String(keno.maxPicks || ''));
    setKenoMaxPayout(String(keno.maxPayoutEtb || ''));
    setKenoMaxMultiplier(String(keno.maxMultiplier || ''));
    setKenoPayouts(payoutToLines(keno.payoutTable));
    setRouletteBets(listToText(roulette.bettingAmounts));
    setRouletteCountdown(String(roulette.countdownSeconds || ''));
    setRouletteResultSeconds(String(roulette.resultDisplaySeconds || ''));
    setRouletteMinBet(String(roulette.minBet || ''));
    setRouletteMaxBet(String(roulette.maxBet || ''));
    setRouletteMaxPlayerPayout(String(roulette.maxPlayerPayout || ''));
    setRouletteMaxRoundPayout(String(roulette.maxRoundPayout || ''));
    setRouletteCommission(String(roulette.commissionRate || ''));
    setWalletMinWithdraw(String(wallet.minWithdrawEtb || ''));
    setWalletMaxWithdraw(String(wallet.maxWithdrawEtb || ''));
    setWalletDailyWithdraw(String(wallet.dailyWithdrawLimitEtb || ''));
    setWalletSignupPromoEnabled(wallet.signupPromoEnabled === false ? 'paused' : 'active');
    setWalletSignupPromoAmount(String(wallet.signupPromoAmount ?? 50));
    setWalletFeeEnabled(wallet.withdrawalFeeEnabled === true ? 'active' : 'paused');
    setWalletFeeRate(String(wallet.withdrawalFeeRate || ''));
    setWalletFeeFlat(String(wallet.withdrawalFeeFlat || ''));
  }, [JSON.stringify(active)]);

  const askPassword = async (title: string, note: string, summary: React.ReactNode, tone: 'primary' | 'green' | 'red' | 'amber' = 'amber') => {
    if (!note.trim()) return null;
    return ask({
      title,
      description: 'Master Admin password is required. Game changes apply after the current active round finishes when applicable.',
      summary,
      fields: [{ name: 'password', label: 'Master Admin Password', type: 'password', required: true }],
      confirmText: 'Save Changes',
      tone,
    });
  };

  const savePolicy = async () => {
    const result = await askPassword('Save Player Policies', policyNote, <div>Policy title: <b>{policyTitle}</b></div>, 'primary');
    if (!result) return;
    emit('adminUpdatePolicies', { title: policyTitle, body: policyBody, note: policyNote, password: result.password });
    setPolicyNote('');
  };

  const saveTelegram = async () => {
    const ids = chatIds.split(/[,\n\s]+/).map((x) => x.trim()).filter(Boolean);
    if (ids.length > 5) return;
    const result = await askPassword('Save Telegram Settings', tgNote, <div>Admin chat IDs: <b>{ids.length}/5</b><br />Admin alert bot: <b>{adminBotToken ? 'new token provided' : (telegram.hasDedicatedAdminBot ? 'already configured' : 'fallback to game bot')}</b></div>, 'primary');
    if (!result) return;
    emit('adminUpdateTelegramSettings', { botToken, adminBotToken, botUsername, adminChatIds: ids, note: tgNote, password: result.password });
    setBotToken('');
    setAdminBotToken('');
    setTgNote('');
  };

  const saveGame = async (game: string, settings: any, note: string) => {
    const result = await askPassword(
      `Save ${human(game)} Settings`,
      note,
      <div>
        Section: <b>{human(game)}</b>
        <br />
        Changes: <b>{Object.keys(settings).length}</b> fields
      </div>,
      'amber',
    );
    if (!result) return;
    emit('adminUpdateGameSettings', { game, settings, note, password: result.password });
  };

  const saveBingo = () => saveGame('bingo', {
    bettingAmounts: parseNumberList(bingoBets),
    minPlayers: numberValue(bingoMinPlayers),
    maxPlayers: numberValue(bingoMaxPlayers),
    countdownSeconds: numberValue(bingoCountdown),
    drawIntervalMs: numberValue(bingoDrawMs),
    winnerShare: numberValue(bingoWinnerShare),
    commissionRate: numberValue(bingoCommission),
    falseClaimFirstPenaltySeconds: numberValue(bingoFirstPenalty),
    falseClaimRepeatPenaltySeconds: numberValue(bingoRepeatPenalty),
  }, bingoNote);

  const saveKeno = () => saveGame('keno', {
    bettingAmounts: parseNumberList(kenoBets),
    minBet: numberValue(kenoMinBet),
    maxBet: numberValue(kenoMaxBet),
    maxPicks: numberValue(kenoMaxPicks),
    maxPayoutEtb: numberValue(kenoMaxPayout),
    maxMultiplier: numberValue(kenoMaxMultiplier),
    payoutTable: linesToPayout(kenoPayouts),
  }, kenoNote);

  const saveRoulette = () => saveGame('roulette', {
    bettingAmounts: parseNumberList(rouletteBets),
    countdownSeconds: numberValue(rouletteCountdown),
    resultDisplaySeconds: numberValue(rouletteResultSeconds),
    minBet: numberValue(rouletteMinBet),
    maxBet: numberValue(rouletteMaxBet),
    maxPlayerPayout: numberValue(rouletteMaxPlayerPayout),
    maxRoundPayout: numberValue(rouletteMaxRoundPayout),
    commissionRate: numberValue(rouletteCommission),
  }, rouletteNote);

  const saveWallet = () => saveGame('wallet', {
    minWithdrawEtb: numberValue(walletMinWithdraw),
    maxWithdrawEtb: numberValue(walletMaxWithdraw),
    dailyWithdrawLimitEtb: numberValue(walletDailyWithdraw),
    signupPromoEnabled: walletSignupPromoEnabled === 'active',
    signupPromoAmount: numberValue(walletSignupPromoAmount),
    withdrawalFeeEnabled: walletFeeEnabled === 'active',
    withdrawalFeeRate: numberValue(walletFeeRate),
    withdrawalFeeFlat: numberValue(walletFeeFlat),
  }, walletNote);

  return (
    <>
      <PageTitle title="Settings" subtitle="Master-only policy, Telegram, game rules, and wallet controls." />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <SectionHeader title="Player Policies" icon={Shield} />
          <div className="grid gap-3">
            <Field label="Policy Title" value={policyTitle} onChange={setPolicyTitle} />
            <TextArea label="Policy Body" value={policyBody} onChange={setPolicyBody} rows={12} />
            <Field label="Update Reason" value={policyNote} onChange={setPolicyNote} />
            <Button tone="primary" onClick={savePolicy}>Save Policies</Button>
          </div>
        </Card>
        <Card>
          <SectionHeader title="Telegram Bot & Alerts" icon={Bell} />
          <div className="grid gap-3">
            <Field label="Game Bot Token (players)" value={botToken} onChange={setBotToken} type="password" placeholder={telegram.hasBotToken ? telegram.botTokenPreview : 'Bot token'} />
            <Field label="Game Bot Username" value={botUsername} onChange={setBotUsername} placeholder="@your_bot_username" />
            <Field label="Admin Alert Bot Token (staff only)" value={adminBotToken} onChange={setAdminBotToken} type="password" placeholder={telegram.hasAdminBotToken ? telegram.adminBotTokenPreview : 'Admin alert bot token'} />
            <Field label="Admin Chat IDs (max 5)" value={chatIds} onChange={setChatIds} />
            <p className="text-xs font-semibold text-slate-500">The game bot token and username are used for player Telegram links. Enter the username without or with @.</p>
            <p className="text-xs font-semibold text-slate-500">Admin alerts use the staff bot when configured. If it is empty, alerts fall back to the game bot.</p>
            <Field label="Reason" value={tgNote} onChange={setTgNote} />
            <Button tone="primary" onClick={saveTelegram}>Save Telegram</Button>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <SectionHeader title="Bingo Rules" icon={Gamepad2} />
          <p className="mb-3 text-sm font-semibold text-slate-400">Room size, draw speed, penalties, and commission. Applies after the current Bingo round.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Betting Amounts" value={bingoBets} onChange={setBingoBets} />
            <Field label="Min Players" value={bingoMinPlayers} onChange={setBingoMinPlayers} type="number" />
            <Field label="Max Players" value={bingoMaxPlayers} onChange={setBingoMaxPlayers} type="number" />
            <Field label="Countdown Seconds" value={bingoCountdown} onChange={setBingoCountdown} type="number" />
            <Field label="Draw Interval ms" value={bingoDrawMs} onChange={setBingoDrawMs} type="number" />
            <Field label="Winner Share" value={bingoWinnerShare} onChange={setBingoWinnerShare} type="number" />
            <Field label="Commission Rate" value={bingoCommission} onChange={setBingoCommission} type="number" />
            <Field label="False Claim 1st Penalty" value={bingoFirstPenalty} onChange={setBingoFirstPenalty} type="number" />
            <Field label="False Claim Repeat Penalty" value={bingoRepeatPenalty} onChange={setBingoRepeatPenalty} type="number" />
            <Field label="Reason" value={bingoNote} onChange={setBingoNote} />
          </div>
          <Button className="mt-3" tone="amber" onClick={saveBingo}>Save Bingo</Button>
        </Card>

        <Card>
          <SectionHeader title="Roulette Rules" icon={CircleDollarSign} />
          <p className="mb-3 text-sm font-semibold text-slate-400">Chip amounts, round timing, commission, and payout exposure. Applies after the current Roulette round.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Chip Amounts" value={rouletteBets} onChange={setRouletteBets} />
            <Field label="Countdown Seconds" value={rouletteCountdown} onChange={setRouletteCountdown} type="number" />
            <Field label="Result Display Seconds" value={rouletteResultSeconds} onChange={setRouletteResultSeconds} type="number" />
            <Field label="Min Bet" value={rouletteMinBet} onChange={setRouletteMinBet} type="number" />
            <Field label="Max Bet" value={rouletteMaxBet} onChange={setRouletteMaxBet} type="number" />
            <Field label="Max Player Payout" value={rouletteMaxPlayerPayout} onChange={setRouletteMaxPlayerPayout} type="number" />
            <Field label="Max Round Payout" value={rouletteMaxRoundPayout} onChange={setRouletteMaxRoundPayout} type="number" />
            <Field label="Commission Rate" value={rouletteCommission} onChange={setRouletteCommission} type="number" />
            <Field label="Reason" value={rouletteNote} onChange={setRouletteNote} />
          </div>
          <Button className="mt-3" tone="amber" onClick={saveRoulette}>Save Roulette</Button>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <Card>
          <SectionHeader title="Keno Rules" icon={BarChart3} />
          <p className="mb-3 text-sm font-semibold text-slate-400">No JSON editing. Write each prize rule like: 10 picks, 8 hits = 20x.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Betting Amounts" value={kenoBets} onChange={setKenoBets} />
            <Field label="Min Bet" value={kenoMinBet} onChange={setKenoMinBet} type="number" />
            <Field label="Max Bet" value={kenoMaxBet} onChange={setKenoMaxBet} type="number" />
            <Field label="Max Picks" value={kenoMaxPicks} onChange={setKenoMaxPicks} type="number" />
            <Field label="Max Payout ETB" value={kenoMaxPayout} onChange={setKenoMaxPayout} type="number" />
            <Field label="Max Multiplier" value={kenoMaxMultiplier} onChange={setKenoMaxMultiplier} type="number" />
          </div>
          <div className="mt-3">
            <TextArea label="Prize Rules" value={kenoPayouts} onChange={setKenoPayouts} rows={12} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Reason" value={kenoNote} onChange={setKenoNote} />
            <div className="flex items-end"><Button tone="amber" onClick={saveKeno}>Save Keno</Button></div>
          </div>
        </Card>

        <Card>
          <SectionHeader title="Wallet / Withdrawals" icon={Wallet} />
          <p className="mb-3 text-sm font-semibold text-slate-400">Signup gifts, withdrawal limits, and withdrawal fees. Wallet settings apply immediately.</p>
          <div className="grid gap-3">
            <SelectField label="New Account Gift" value={walletSignupPromoEnabled} onChange={setWalletSignupPromoEnabled} options={[{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }]} />
            <Field label="New Account Gift Amount" value={walletSignupPromoAmount} onChange={setWalletSignupPromoAmount} type="number" />
            <Field label="Min Withdrawal" value={walletMinWithdraw} onChange={setWalletMinWithdraw} type="number" />
            <Field label="Max Withdrawal" value={walletMaxWithdraw} onChange={setWalletMaxWithdraw} type="number" />
            <Field label="Daily Withdrawal Limit" value={walletDailyWithdraw} onChange={setWalletDailyWithdraw} type="number" />
            <SelectField label="Withdrawal Fee" value={walletFeeEnabled} onChange={setWalletFeeEnabled} options={[{ value: 'paused', label: 'Paused' }, { value: 'active', label: 'Active' }]} />
            <Field label="Withdrawal Fee Rate" value={walletFeeRate} onChange={setWalletFeeRate} type="number" />
            <Field label="Withdrawal Flat Fee" value={walletFeeFlat} onChange={setWalletFeeFlat} type="number" />
            <Field label="Reason" value={walletNote} onChange={setWalletNote} />
            <Button tone="amber" onClick={saveWallet}>Save Wallet</Button>
          </div>
        </Card>
      </div>
    </>
  );
}

function AnalyticsPage({ data }: { data: AdminData }) {
  const referralRows = data.referralPerformance || [];
  return (
    <>
      <PageTitle title="Analytics" subtitle="Per-game performance and profitability." />
      <Table
        headers={['Game', 'Players', 'Games', 'Total Bet', 'Paid Out', 'House Profit', 'House Loss', 'Avg/Game']}
        rows={((data.analytics && data.analytics.byGame) || []).map((a: any) => [a.game, a.totalPlayersToDate || 0, a.totalGamesPlayed || 0, fmtMoney(a.totalBetAmount), fmtMoney(a.totalPaidOutAmount), fmtMoney(a.houseProfitToDate), fmtMoney(a.houseLossesToDate), fmtMoney(a.averageProfitPerGame)])}
      />
      <div className="mt-6">
        <PageTitle title="Senior Admin Referrals" subtitle="Attribution for personalized Telegram links. Pay performance from net house profit, not raw deposits." />
        <Table
          headers={['Admin', 'Referral Link', 'Players', 'Deposits', 'Withdrawals', 'Bet Volume', 'Paid Out', 'Net', 'By Game']}
          rows={referralRows.map((r: any) => [
            <div><b>{r.name}</b><div className="text-xs text-slate-500">{r.username}</div></div>,
            r.referralLink ? <button className="max-w-[260px] truncate text-left text-xs font-black text-amber-200 underline decoration-amber-300/30" onClick={() => copyToClipboard(r.referralLink)}>{r.referralCode}</button> : '-',
            <div><b>{r.totalPlayers || 0}</b><div className="text-xs text-slate-500">{r.activePlayers || 0} active</div></div>,
            fmtMoney(r.totalDeposits),
            fmtMoney(r.totalWithdrawals),
            fmtMoney(r.totalBet),
            fmtMoney(r.totalPayout),
            <span className={Number(r.netHouseProfit || 0) >= 0 ? 'font-black text-emerald-300' : 'font-black text-red-300'}>{fmtMoney(r.netHouseProfit)}</span>,
            <div className="grid gap-1 text-xs text-slate-400">{(r.byGame || []).map((g: any) => <span key={g.game}>{g.game}: {g.games || 0} games, {fmtMoney(g.netHouseProfit)} net</span>)}</div>,
          ])}
        />
      </div>
    </>
  );
}

function PasswordLockModal({ emit, admin }: { emit: (event: string, payload?: any) => void; admin: any }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  return (
    <Modal title="Change Temporary Password" locked onClose={() => {}}>
      <div className="grid gap-4">
        <p className="text-sm font-semibold text-slate-400">Welcome {admin?.name || admin?.username || 'Admin'}. For security, change your temporary password before using the dashboard.</p>
        <Field label="Current Temporary Password" value={currentPassword} onChange={setCurrentPassword} type="password" />
        <Field label="New Password" value={newPassword} onChange={setNewPassword} type="password" />
        <Button tone="primary" onClick={() => emit('adminChangeOwnPassword', { currentPassword, newPassword })}>Change Password</Button>
      </div>
    </Modal>
  );
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<TabKey>('work');
  const [toasts, setToasts] = useState<Array<{ id: number; type: string; message: string }>>([]);
  const [actionDialog, setActionDialog] = useState<(ActionRequest & { resolve: (values: Record<string, string> | null) => void }) | null>(null);

  const notify = (type: string, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, type, message }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 4200);
  };

  const onLogin = (s: Socket, incoming: AdminData, token?: string) => {
    if (token) localStorage.setItem(SESSION_KEY, token);
    setSocket(s);
    setData(incoming);
    setupSocketListeners(s);
  };

  const setupSocketListeners = (s: Socket) => {
    s.off('adminAuth');
    s.off('adminData');
    s.off('notification');
    s.off('adminCreateUserResult');
    s.on('adminAuth', (res: any) => {
      if (!res.success) {
        localStorage.removeItem(SESSION_KEY);
        notify('error', res.message || 'Admin session expired.');
        setTimeout(() => location.reload(), 700);
      }
    });
    s.on('adminData', (d: AdminData) => setData(d));
    s.on('notification', (n: any) => notify(n.type || 'success', n.message || 'Done.'));
    s.on('adminCreateUserResult', (res: any) => {
      notify(res.success ? 'success' : 'error', res.message || (res.success ? 'Admin created.' : 'Admin creation failed.'));
      if (res.success && res.admin) {
        notify('success', `New admin login: ${res.admin.username || res.admin.phone}. Temporary password was set by Master Admin.`);
      }
    });
  };

  useEffect(() => {
    const token = localStorage.getItem(SESSION_KEY);
    if (!token) return;
    const s = io();
    let done = false;
    s.on('connect', () => s.emit('adminResumeSession', { token }));
    s.once('adminAuth', (res: any) => {
      done = true;
      if (res.success) {
        if (res.token) localStorage.setItem(SESSION_KEY, res.token);
        setSocket(s);
        setData(res.data);
        setupSocketListeners(s);
      } else {
        localStorage.removeItem(SESSION_KEY);
        s.disconnect();
      }
    });
    s.on('connect_error', () => {
      if (!done) s.disconnect();
    });
    return () => {
      if (!done) s.disconnect();
    };
  }, []);

  const emit = (event: string, payload: any = {}) => {
    if (!socket) {
      notify('error', 'Admin connection is not ready.');
      return;
    }
    socket.emit(event, payload);
  };

  const ask: AskAction = (request) =>
    new Promise((resolve) => {
      setActionDialog({ ...request, resolve });
    });

  const closeActionDialog = () => {
    actionDialog?.resolve(null);
    setActionDialog(null);
  };

  const submitActionDialog = (values: Record<string, string>) => {
    actionDialog?.resolve(values);
    setActionDialog(null);
  };

  const refresh = () => emit('adminGetData');
  const logout = () => {
    const token = localStorage.getItem(SESSION_KEY) || '';
    localStorage.removeItem(SESSION_KEY);
    socket?.emit('adminLogout', { token });
    socket?.disconnect();
    setSocket(null);
    setData(null);
  };

  let content: React.ReactNode = null;
  if (data) {
    if (tab === 'work') content = <WorkPage data={data} emit={emit} ask={ask} />;
    if (tab === 'overview') content = <OverviewPage data={data} />;
    if (tab === 'players') content = <PlayersPage data={data} emit={emit} ask={ask} />;
    if (tab === 'payments') content = <PaymentsPage data={data} emit={emit} ask={ask} />;
    if (tab === 'requests') content = <RequestsPage data={data} emit={emit} ask={ask} />;
    if (tab === 'games') content = <GamesPage data={data} emit={emit} ask={ask} />;
    if (tab === 'finance') content = <FinancePage data={data} emit={emit} ask={ask} />;
    if (tab === 'history') content = <HistoryPage data={data} />;
    if (tab === 'admins') content = <AdminsPage data={data} emit={emit} ask={ask} />;
    if (tab === 'settings') content = <SettingsPage data={data} emit={emit} ask={ask} />;
    if (tab === 'account') content = <AccountPage data={data} emit={emit} />;
  }

  return (
    <>
      {!data ? (
        <LoginPage onLogin={onLogin} notify={notify} />
      ) : (
        <Layout data={data} tab={tab} setTab={setTab} onRefresh={refresh} onLogout={logout}>
          {content}
          {can(data, 'analytics') && tab === 'overview' && (
            <div className="mt-5">
              <AnalyticsPage data={data} />
            </div>
          )}
        </Layout>
      )}
      <ActionDialog request={actionDialog} onCancel={closeActionDialog} onSubmit={submitActionDialog} />
      {data?.currentAdmin?.mustChangePassword && <PasswordLockModal admin={data.currentAdmin} emit={emit} />}
      <Toasts toasts={toasts} remove={(id) => setToasts((list) => list.filter((x) => x.id !== id))} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
