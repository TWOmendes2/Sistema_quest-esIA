'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icon';
import { Avatar } from '@/components/ui';
import { cn } from '@/lib/cn';

type ManagementRole = 'admin' | 'coordinator' | 'teacher';
type NavItem = { label: string; href: Route; icon: IconName; keywords?: string; roles?: ManagementRole[] };
type NavSection = { title?: string; items: NavItem[] };

const studentNavigation: NavSection[] = [
  { items: [
    { label: 'Visão geral', href: '/dashboard', icon: 'home' },
    { label: 'Simulados', href: '/simulados', icon: 'book' },
    { label: 'Histórico', href: '/historico', icon: 'history' },
    { label: 'Ranking', href: '/ranking', icon: 'trophy' },
    { label: 'Desempenho', href: '/desempenho', icon: 'chart' }
  ] },
  { title: 'Conta', items: [{ label: 'Meu perfil', href: '/perfil', icon: 'user' }] }
];

const managementNavigation: NavSection[] = [
  { items: [{ label: 'Visão geral', href: '/admin', icon: 'home' }] },
  { title: 'Acadêmico', items: [
    { label: 'Cadastros pendentes', href: '/admin/cadastros-pendentes', icon: 'alert', roles: ['admin', 'coordinator'] },
    { label: 'Alunos', href: '/admin/alunos', icon: 'users', roles: ['admin', 'coordinator'] },
    { label: 'Turmas', href: '/admin/turmas', icon: 'graduation', roles: ['admin', 'coordinator'] },
    { label: 'Matérias', href: '/admin/materias', icon: 'layers', roles: ['admin', 'coordinator'] }
  ] },
  { title: 'Avaliações', items: [
    { label: 'Simulados', href: '/admin/simulados', icon: 'clipboard' },
    { label: 'Banco de questões', href: '/admin/questoes', icon: 'book' },
    { label: 'Geração por IA', href: '/admin/ia', icon: 'sparkles' }
  ] },
  { title: 'Análise e governança', items: [
    { label: 'Relatórios', href: '/admin/relatorios', icon: 'chart' },
    { label: 'Rankings', href: '/admin/rankings', icon: 'trophy' },
    { label: 'Auditoria', href: '/admin/auditoria', icon: 'shield', roles: ['admin', 'coordinator'] },
    { label: 'Usuários e acessos', href: '/admin/usuarios', icon: 'key', roles: ['admin', 'coordinator'] },
    { label: 'Configurações', href: '/admin/configuracoes', icon: 'settings', roles: ['admin', 'coordinator'] }
  ] }
];

function isCurrentPath(pathname: string, href: string) {
  if (href === '/admin' || href === '/dashboard') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ mode, children, userName = 'Usuário', userSubtitle = 'Conta', brandName = 'Nexo Avalia', managementRole }: { mode: 'student' | 'management'; children: ReactNode; userName?: string; userSubtitle?: string; brandName?: string; managementRole?: ManagementRole }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigation = mode === 'student'
    ? studentNavigation
    : managementNavigation
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => !item.roles || (managementRole ? item.roles.includes(managementRole) : false)),
        }))
        .filter((section) => section.items.length > 0);
  const activityHref = mode === 'student'
    ? '/historico'
    : managementRole === 'teacher'
      ? '/admin/ia'
      : '/admin/auditoria';
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pt-BR');
    if (!term) return [];
    return navigation.flatMap((section) => section.items).filter((item) => `${item.label} ${item.keywords || ''}`.toLocaleLowerCase('pt-BR').includes(term)).slice(0, 6);
  }, [navigation, query]);

  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } finally { window.location.href = '/login'; }
  }

  const sidebar = (
    <aside className="flex h-full w-[272px] flex-col border-r border-slate-200 bg-white text-slate-900">
      <div className="flex h-[74px] items-center gap-3 border-b border-slate-200 px-5">
        <Link href={mode === 'management' ? '/admin' : '/dashboard'} className="min-w-0 flex-1" aria-label={brandName}>
          <Image src="/brand/logo-nexo-avalia.svg" alt={brandName} width={360} height={88} priority className="h-auto w-[190px] max-w-full" />
        </Link>
        <button type="button" onClick={() => setMobileOpen(false)} className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-orange-50 hover:text-orange-600 lg:hidden" aria-label="Fechar menu"><Icon name="close" className="h-5 w-5" /></button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
        {navigation.map((section, sectionIndex) => <div key={section.title ?? sectionIndex} className={cn(sectionIndex > 0 && 'mt-6')}>
          {section.title ? <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{section.title}</p> : null}
          <div className="space-y-1">{section.items.map((item) => {
            const active = isCurrentPath(pathname, item.href);
            return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={cn('group flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition', active ? 'bg-[#ededed] text-[#0b0b0b]' : 'text-slate-500 hover:bg-orange-50 hover:text-orange-600')}><Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" /><span className="min-w-0 flex-1 truncate">{item.label}</span>{active ? <span className="h-1.5 w-1.5 rounded-full bg-black" /> : null}</Link>;
          })}</div>
        </div>)}
      </nav>
      <div className="border-t border-slate-200 p-3"><div className="flex items-center gap-3 rounded-sm px-2 py-2 hover:bg-orange-50"><Avatar name={userName} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-900">{userName}</p><p className="mt-0.5 truncate text-[10px] text-slate-500">{userSubtitle}</p></div><button type="button" onClick={logout} className="rounded-lg p-2 text-slate-500 transition hover:bg-orange-50 hover:text-orange-600" aria-label="Sair"><Icon name="logout" className="h-4 w-4" /></button></div></div>
    </aside>
  );

  const searchBox = (
    <div className="relative">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#555]" placeholder={mode === 'student' ? 'Buscar áreas da plataforma' : 'Buscar no menu administrativo'} />
      {matches.length ? <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-md border border-slate-200 bg-white p-1 shadow-2xl">{matches.map((item) => <Link key={item.href} href={item.href} onClick={() => { setQuery(''); setSearchOpen(false); }} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-orange-50 hover:text-orange-600"><Icon name={item.icon} className="h-4 w-4" />{item.label}</Link>)}</div> : null}
    </div>
  );

  return <div className="app-shell-root min-h-screen bg-white">
    <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</div>
    {mobileOpen ? <div className="fixed inset-0 z-50 lg:hidden"><button type="button" className="absolute inset-0 bg-black/75" onClick={() => setMobileOpen(false)} aria-label="Fechar menu" /><div className="relative h-full w-[272px]">{sidebar}</div></div> : null}
    <div className="lg:pl-[272px]">
      <header className="sticky top-0 z-30 flex h-[74px] items-center border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <button type="button" onClick={() => setMobileOpen(true)} className="mr-3 rounded-lg p-2 text-slate-500 hover:bg-orange-50 hover:text-orange-600 lg:hidden" aria-label="Abrir menu"><Icon name="menu" className="h-5 w-5" /></button>
        <div className="hidden w-full max-w-md md:block">{searchBox}</div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setSearchOpen((value) => !value)} className="rounded-lg p-2.5 text-slate-500 hover:bg-orange-50 hover:text-orange-600 md:hidden" aria-label="Buscar"><Icon name="search" className="h-5 w-5" /></button>
          <Link href={activityHref} className="relative rounded-lg p-2.5 text-slate-500 hover:bg-orange-50 hover:text-orange-600" aria-label="Atividades"><Icon name="bell" className="h-5 w-5" /></Link>
          <div className="ml-1 hidden items-center gap-3 border-l border-slate-200 pl-4 sm:flex"><div className="text-right"><p className="text-xs font-semibold text-slate-900">{userName}</p><p className="mt-0.5 text-[10px] text-slate-500">{userSubtitle}</p></div><Avatar name={userName} size="sm" /></div>
        </div>
      </header>
      {searchOpen ? <div className="border-b border-slate-200 bg-white px-4 py-3 md:hidden">{searchBox}</div> : null}
      <main className="mx-auto max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  </div>;
}
