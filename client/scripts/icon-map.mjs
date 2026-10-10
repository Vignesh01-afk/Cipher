import fs from 'node:fs';
import * as phosphor from '../node_modules/@phosphor-icons/react/dist/index.es.js';

const MAP = {
  Activity: 'Activity',
  AlertCircle: 'WarningCircle',
  AlertOctagon: 'OctagonWarning',
  AlertTriangle: 'Warning',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Ban: 'Ban',
  Bell: 'Bell',
  Camera: 'Camera',
  Check: 'Check',
  CheckCheck: 'Checks',
  CheckCircle2: 'CheckCircle',
  ChevronDown: 'CaretDown',
  Clock: 'Clock',
  Compass: 'Compass',
  Copy: 'Copy',
  Eye: 'Eye',
  EyeOff: 'EyeSlash',
  File: 'File',
  FilePlus2: 'FilePlus',
  FileText: 'FileText',
  FileX2: 'FileX',
  Film: 'Film',
  FolderOpen: 'FolderOpen',
  Home: 'House',
  Image: 'Image',
  Info: 'Info',
  KeyRound: 'Key',
  Link: 'Link',
  Loader2: 'CircleNotch',
  Lock: 'Lock',
  LogIn: 'SignIn',
  LogOut: 'SignOut',
  Mail: 'Mail',
  MessageSquare: 'ChatCircle',
  MonitorX: 'Monitor',
  Moon: 'Moon',
  Music: 'Music',
  RefreshCw: 'ArrowClockwise',
  Save: 'FloppyDisk',
  Search: 'MagnifyingGlass',
  Server: 'Server',
  Settings: 'Gear',
  Share2: 'ShareNetwork',
  Shield: 'Shield',
  ShieldAlert: 'ShieldWarning',
  ShieldCheck: 'ShieldCheck',
  ShieldOff: 'ShieldSlash',
  Sparkles: 'Star',
  Sun: 'Sun',
  Tag: 'Tag',
  Timer: 'Timer',
  Trash2: 'Trash',
  Unlock: 'LockOpen',
  UploadCloud: 'CloudArrowUp',
  User: 'User',
  UserCheck: 'UserCheck',
  UserPlus: 'UserPlus',
  Users: 'Users',
  Wallet: 'Wallet',
  Waves: 'Waves',
  X: 'X',
  XCircle: 'XCircle',
};

const missing = Object.entries(MAP).filter(([_, to]) => typeof phosphor[to] !== 'function');
console.log('mapped', Object.keys(MAP).length, 'missing', missing.length);
for (const [from, to] of missing) console.log('  MISSING', from, '->', to);

// Which installed names look like close matches, to help fill the gaps.
for (const [from] of missing) {
  const rx = new RegExp(from.replace(/[^A-Za-z]/g, ''), 'i');
  const candidates = Object.keys(phosphor)
    .filter((k) => !/Icon$/.test(k) && rx.test(k))
    .slice(0, 8);
  console.log('  candidates for', from, ':', candidates.join(', '));
}
