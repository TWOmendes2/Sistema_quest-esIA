import type { SVGProps } from 'react';
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, Bell, BookOpen, CalendarDays,
  ChartNoAxesColumnIncreasing, Check, CheckCircle2, ChevronDown, ChevronRight,
  Circle, ClipboardList, Clock3, Copy, Database, Download, Edit3, Eye, FileText,
  Filter, Globe2, GraduationCap, History, Home, IdCard, Info, KeyRound, Layers3,
  LockKeyhole, LogOut, Mail, Menu, MoreHorizontal, Pause, Play, Plus, RefreshCw,
  Save, Search, Settings, ShieldCheck, Sparkles, Target, Trash2, Trophy, Upload,
  User, Users, X
} from 'lucide-react';

export type IconName =
  | 'home' | 'book' | 'history' | 'trophy' | 'chart' | 'user' | 'users'
  | 'graduation' | 'layers' | 'clipboard' | 'sparkles' | 'file' | 'shield'
  | 'settings' | 'search' | 'bell' | 'menu' | 'close' | 'logout'
  | 'arrow-right' | 'arrow-left' | 'check' | 'x' | 'clock' | 'calendar'
  | 'target' | 'download' | 'upload' | 'plus' | 'edit' | 'eye' | 'filter'
  | 'chevron-down' | 'chevron-right' | 'lock' | 'mail' | 'id-card' | 'alert'
  | 'info' | 'more' | 'play' | 'pause' | 'save' | 'trash' | 'copy'
  | 'refresh' | 'database' | 'key' | 'globe' | 'check-circle'
  | 'alert-circle' | 'circle';

type IconProps = SVGProps<SVGSVGElement> & { name: IconName };
type LucideIcon = typeof Home;

const icons: Record<IconName, LucideIcon> = {
  home: Home,
  book: BookOpen,
  history: History,
  trophy: Trophy,
  chart: ChartNoAxesColumnIncreasing,
  user: User,
  users: Users,
  graduation: GraduationCap,
  layers: Layers3,
  clipboard: ClipboardList,
  sparkles: Sparkles,
  file: FileText,
  shield: ShieldCheck,
  settings: Settings,
  search: Search,
  bell: Bell,
  menu: Menu,
  close: X,
  logout: LogOut,
  'arrow-right': ArrowRight,
  'arrow-left': ArrowLeft,
  check: Check,
  x: X,
  clock: Clock3,
  calendar: CalendarDays,
  target: Target,
  download: Download,
  upload: Upload,
  plus: Plus,
  edit: Edit3,
  eye: Eye,
  filter: Filter,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  lock: LockKeyhole,
  mail: Mail,
  'id-card': IdCard,
  alert: AlertTriangle,
  info: Info,
  more: MoreHorizontal,
  play: Play,
  pause: Pause,
  save: Save,
  trash: Trash2,
  copy: Copy,
  refresh: RefreshCw,
  database: Database,
  key: KeyRound,
  globe: Globe2,
  'check-circle': CheckCircle2,
  'alert-circle': AlertCircle,
  circle: Circle
};

export function Icon({ name, className = 'h-5 w-5', ...props }: IconProps) {
  const Component = icons[name] || Circle;
  return <Component className={className} strokeWidth={1.75} aria-hidden="true" {...props} />;
}
