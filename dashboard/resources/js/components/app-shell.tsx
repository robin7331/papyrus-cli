import { Link, usePage } from '@inertiajs/react';
import { MenuIcon } from 'lucide-react';
import type { PropsWithChildren } from 'react';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { home } from '@/routes';
import { index as bwaIndex } from '@/routes/bwa';
import { index as belegeIndex } from '@/routes/belege';
import { index as transaktionenIndex } from '@/routes/transaktionen';

const navigationItems = [
    {
        href: home.url(),
        label: 'Home',
        matches: (url: string) => url === '/',
    },
    {
        href: bwaIndex.url(),
        label: 'BWA',
        matches: (url: string) => url.startsWith('/bwa'),
    },
    {
        href: transaktionenIndex.url(),
        label: 'Transaktionen',
        matches: (url: string) => url.startsWith('/transaktionen'),
    },
    {
        href: belegeIndex.url(),
        label: 'Belege',
        matches: (url: string) => url.startsWith('/belege'),
    },
];

export function AppShell({ children }: PropsWithChildren) {
    const page = usePage();

    return (
        <div className="relative min-h-screen overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.26),_transparent_32%),radial-gradient(circle_at_20%_20%,_rgba(37,99,235,0.18),_transparent_30%)]" />
            <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
                <header className="sticky top-4 z-30 mb-8">
                    <div className="flex items-center justify-between rounded-[1.9rem] border border-white/70 bg-white/85 px-4 py-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:px-6">
                        <div className="flex items-center gap-3">
                            <Link
                                className="flex items-center gap-3"
                                href={home.url()}
                            >
                                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-brand-900)] text-base font-semibold text-white">
                                    BM
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate text-base font-semibold tracking-tight text-slate-950">
                                        BitMechanics Buchhaltung
                                    </p>
                                    <p className="truncate text-xs tracking-[0.22em] text-slate-500 uppercase">
                                        Jahresabschluss, Belege und Abgleich
                                    </p>
                                </div>
                            </Link>
                        </div>

                        <nav className="hidden items-center gap-2 md:flex">
                            {navigationItems.map((item) => {
                                const isActive = item.matches(page.url);

                                return (
                                    <Button
                                        asChild
                                        className={cn(
                                            'rounded-full px-5',
                                            isActive &&
                                                'bg-[var(--color-brand-900)] text-white shadow-[0_12px_30px_rgba(22,50,79,0.22)] hover:bg-[var(--color-brand-900)]',
                                        )}
                                        key={item.href}
                                        variant={isActive ? 'default' : 'ghost'}
                                    >
                                        <Link href={item.href} prefetch>
                                            {item.label}
                                        </Link>
                                    </Button>
                                );
                            })}
                        </nav>

                        <div className="hidden items-center gap-3 md:flex">
                            <div className="rounded-full bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900">
                                SKR 03
                            </div>
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-slate-950">
                                RM
                            </div>
                        </div>

                        <Sheet>
                            <SheetTrigger asChild>
                                <Button
                                    className="rounded-full md:hidden"
                                    size="icon"
                                    variant="outline"
                                >
                                    <MenuIcon />
                                    <span className="sr-only">
                                        Navigation öffnen
                                    </span>
                                </Button>
                            </SheetTrigger>
                            <SheetContent className="border-l-white/60 bg-white/95 sm:max-w-xs">
                                <SheetHeader>
                                    <SheetTitle>
                                        BitMechanics Buchhaltung
                                    </SheetTitle>
                                    <SheetDescription>
                                        Direkter Wechsel zwischen Übersicht,
                                        BWA, Transaktionen und Belegen.
                                    </SheetDescription>
                                </SheetHeader>
                                <div className="flex flex-col gap-3 px-4 pb-6">
                                    {navigationItems.map((item) => {
                                        const isActive = item.matches(page.url);

                                        return (
                                            <Button
                                                asChild
                                                className="justify-start rounded-2xl"
                                                key={item.href}
                                                variant={
                                                    isActive
                                                        ? 'default'
                                                        : 'ghost'
                                                }
                                            >
                                                <Link href={item.href}>
                                                    {item.label}
                                                </Link>
                                            </Button>
                                        );
                                    })}
                                </div>
                            </SheetContent>
                        </Sheet>
                    </div>
                </header>

                <main className="relative z-10 flex-1">{children}</main>
            </div>
        </div>
    );
}
