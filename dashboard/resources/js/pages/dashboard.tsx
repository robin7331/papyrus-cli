import { Head, Link, router, usePage } from '@inertiajs/react';
import { ArrowRightIcon, RefreshCcwIcon } from 'lucide-react';
import { useState } from 'react';
import SyncYearController from '@/actions/App/Http/Controllers/SyncYearController';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
    formatCount,
    formatCurrency,
    formatDate,
    formatDateTime,
    formatYearLabel,
} from '@/lib/bookkeeping';
import { cn } from '@/lib/utils';
import { home } from '@/routes';
import { index as belegeIndex } from '@/routes/belege';
import { index as transaktionenIndex } from '@/routes/transaktionen';
import type {
    FlashProps,
    HomePageProps,
    TransactionRow,
    YearSyncState,
} from '@/types';

function syncStateLabel(state: YearSyncState): string {
    const belegeReady = !state.source_has_belege || state.has_belege;
    const transactionsReady =
        !state.source_has_transactions || state.has_transactions;

    if (belegeReady && transactionsReady) {
        return 'vollständig';
    }

    if (state.has_belege || state.has_transactions) {
        return 'teilweise';
    }

    return 'offen';
}

function syncStateClasses(state: YearSyncState): string {
    const belegeReady = !state.source_has_belege || state.has_belege;
    const transactionsReady =
        !state.source_has_transactions || state.has_transactions;

    if (belegeReady && transactionsReady) {
        return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    }

    if (state.has_belege || state.has_transactions) {
        return 'border-amber-200 bg-amber-50 text-amber-800';
    }

    return 'border-slate-200 bg-slate-50 text-slate-700';
}

function amountTone(row: TransactionRow): string {
    return row.amount_cents >= 0 ? 'text-emerald-700' : 'text-rose-700';
}

export default function Dashboard({
    availableYears,
    selectedYear,
    yearSyncStates,
    stats,
    recentTransactions,
    recentBelege,
}: HomePageProps) {
    const { flash } = usePage<{ flash: FlashProps }>().props;
    const [syncingYear, setSyncingYear] = useState<number | null>(null);

    const selectedYearLabel = formatYearLabel(selectedYear);

    const changeYear = (year: string) => {
        router.visit(
            home({
                query: {
                    year,
                },
            }),
            {
                preserveScroll: true,
                preserveState: true,
                replace: true,
            },
        );
    };

    const syncYear = (year: number) => {
        setSyncingYear(year);

        router.visit(SyncYearController(year), {
            preserveScroll: true,
            preserveState: true,
            onFinish: () => {
                setSyncingYear(null);
            },
        });
    };

    return (
        <>
            <Head title="Home" />

            <AppShell>
                <div className="space-y-6 pb-10">
                    {(flash.success || flash.error) && (
                        <Card
                            className={cn(
                                'border shadow-sm',
                                flash.error
                                    ? 'border-rose-200 bg-rose-50/80'
                                    : 'border-emerald-200 bg-emerald-50/80',
                            )}
                        >
                            <CardContent className="py-4 text-sm font-medium">
                                {flash.success ?? flash.error}
                            </CardContent>
                        </Card>
                    )}

                    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                        <div className="relative overflow-hidden rounded-[2rem] bg-[linear-gradient(135deg,#16324f_0%,#102540_60%,#0b1220_100%)] px-6 py-7 text-white shadow-[0_30px_90px_rgba(22,50,79,0.24)] sm:px-8 sm:py-8">
                            <div className="absolute top-[-3rem] right-[-4rem] h-72 w-72 rounded-full bg-[radial-gradient(circle,_rgba(245,158,11,0.95)_0%,_rgba(245,158,11,0)_65%)]" />
                            <div className="absolute bottom-[-7rem] left-1/2 h-72 w-72 rounded-full bg-[radial-gradient(circle,_rgba(59,130,246,0.34)_0%,_rgba(59,130,246,0)_70%)]" />

                            <div className="relative flex h-full flex-col justify-between gap-8">
                                <div className="space-y-5">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <Badge className="rounded-full border-white/15 bg-white/10 text-white hover:bg-white/10">
                                            Home
                                        </Badge>
                                        <span className="text-xs tracking-[0.24em] text-sky-100/80 uppercase">
                                            Fokus auf {selectedYearLabel}
                                        </span>
                                    </div>

                                    <div className="space-y-4">
                                        <h1
                                            className="max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
                                            style={{
                                                fontFamily:
                                                    'var(--font-display)',
                                            }}
                                        >
                                            Buchhaltung ohne Sucherei zwischen
                                            Kontoauszug, PayPal und Beleg.
                                        </h1>
                                        <p className="max-w-3xl text-lg leading-8 text-slate-200">
                                            Die Startseite bündelt offenen
                                            Handlungsbedarf, Datenstand und die
                                            schnellsten Wege in Transaktionen
                                            und Belege.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex flex-wrap gap-3">
                                        <Button
                                            asChild
                                            className="h-11 rounded-2xl bg-white px-5 text-slate-950 hover:bg-white/90"
                                            size="lg"
                                        >
                                            <Link
                                                href={transaktionenIndex.url({
                                                    query: {
                                                        year: selectedYear,
                                                    },
                                                })}
                                            >
                                                Zu Transaktionen
                                                <ArrowRightIcon />
                                            </Link>
                                        </Button>
                                        <Button
                                            asChild
                                            className="h-11 rounded-2xl border-white/15 bg-white/10 px-5 text-white hover:bg-white/15"
                                            size="lg"
                                            variant="outline"
                                        >
                                            <Link
                                                href={belegeIndex.url({
                                                    query: {
                                                        year: selectedYear,
                                                    },
                                                })}
                                            >
                                                Zu Belegen
                                            </Link>
                                        </Button>
                                    </div>

                                    <div className="w-full max-w-56">
                                        <Select
                                            onValueChange={changeYear}
                                            value={selectedYear}
                                        >
                                            <SelectTrigger className="h-11 w-full rounded-2xl border-white/15 bg-white/10 text-white">
                                                <SelectValue placeholder="Jahr wählen" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">
                                                    Alle Jahre
                                                </SelectItem>
                                                {availableYears.map((year) => (
                                                    <SelectItem
                                                        key={year}
                                                        value={String(year)}
                                                    >
                                                        {year}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                            <Card className="rounded-[1.8rem] border-amber-200/70 bg-amber-50/80 shadow-[0_20px_55px_rgba(245,158,11,0.12)]">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-xs tracking-[0.24em] text-amber-900/80 uppercase">
                                        Offene Punkte
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <div
                                        className="text-5xl font-semibold tracking-tight text-amber-950"
                                        style={{
                                            fontFamily: 'var(--font-display)',
                                        }}
                                    >
                                        {formatCount(
                                            stats.missing_pdf_count +
                                                stats.missing_counterparty_count,
                                        )}
                                    </div>
                                    <p className="text-sm leading-6 text-amber-900">
                                        {stats.missing_pdf_count} fehlende PDFs
                                        und {stats.missing_counterparty_count}{' '}
                                        Belege ohne Lieferant im aktuellen
                                        Filter.
                                    </p>
                                </CardContent>
                            </Card>

                            <Card className="rounded-[1.8rem] border-white/80 bg-white/90 shadow-[0_20px_55px_rgba(15,23,42,0.08)]">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                        Datenstand
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex items-end gap-3">
                                        <div
                                            className="text-4xl font-semibold tracking-tight text-slate-950"
                                            style={{
                                                fontFamily:
                                                    'var(--font-display)',
                                            }}
                                        >
                                            {stats.latest_synced_year ?? '–'}
                                        </div>
                                        <div className="pb-1 text-sm font-semibold text-emerald-700">
                                            zuletzt synchronisiert
                                        </div>
                                    </div>
                                    <div className="space-y-2 text-sm text-slate-600">
                                        <div className="flex items-center justify-between">
                                            <span>Transaktionen</span>
                                            <span className="font-semibold text-slate-950">
                                                {formatCount(
                                                    stats.transaction_count,
                                                )}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span>Belege</span>
                                            <span className="font-semibold text-slate-950">
                                                {formatCount(stats.beleg_count)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span>Sync-Rückstand</span>
                                            <span className="font-semibold text-slate-950">
                                                {formatCount(
                                                    stats.years_pending_sync,
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                    <Separator />
                                    <p className="text-xs tracking-[0.18em] text-slate-500 uppercase">
                                        {formatDateTime(stats.latest_synced_at)}
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    </section>

                    <section className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2
                                    className="text-2xl font-semibold tracking-tight text-slate-950"
                                    style={{
                                        fontFamily: 'var(--font-display)',
                                    }}
                                >
                                    Jahresabgleich
                                </h2>
                                <p className="mt-1 text-sm text-slate-600">
                                    Pro Jahr sichtbar, ob Belege und
                                    Transaktionen bereits in der App-Datenbank
                                    angekommen sind.
                                </p>
                            </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-3">
                            {yearSyncStates.map((state) => (
                                <Card
                                    className="rounded-[1.8rem] border-white/80 bg-white/90 shadow-[0_20px_55px_rgba(15,23,42,0.06)]"
                                    key={state.year}
                                >
                                    <CardHeader className="gap-4">
                                        <div className="flex items-center justify-between gap-4">
                                            <div>
                                                <p className="text-sm tracking-[0.22em] text-slate-500 uppercase">
                                                    Jahr
                                                </p>
                                                <CardTitle
                                                    className="text-3xl text-slate-950"
                                                    style={{
                                                        fontFamily:
                                                            'var(--font-display)',
                                                    }}
                                                >
                                                    {state.year}
                                                </CardTitle>
                                            </div>
                                            <Badge
                                                className={cn(
                                                    'rounded-full border',
                                                    syncStateClasses(state),
                                                )}
                                                variant="outline"
                                            >
                                                {syncStateLabel(state)}
                                            </Badge>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                            <div className="rounded-2xl bg-slate-50 p-3">
                                                <div className="text-slate-500">
                                                    Belege
                                                </div>
                                                <div className="mt-2 text-lg font-semibold text-slate-950">
                                                    {formatCount(
                                                        state.last_seen_belege_count,
                                                    )}
                                                </div>
                                                <div className="mt-1 text-xs text-slate-500">
                                                    Quelle{' '}
                                                    {state.source_has_belege
                                                        ? 'vorhanden'
                                                        : 'fehlt'}
                                                </div>
                                            </div>
                                            <div className="rounded-2xl bg-slate-50 p-3">
                                                <div className="text-slate-500">
                                                    Transaktionen
                                                </div>
                                                <div className="mt-2 text-lg font-semibold text-slate-950">
                                                    {formatCount(
                                                        state.last_seen_transaction_count,
                                                    )}
                                                </div>
                                                <div className="mt-1 text-xs text-slate-500">
                                                    Quelle{' '}
                                                    {state.source_has_transactions
                                                        ? 'vorhanden'
                                                        : 'fehlt'}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2 text-sm text-slate-600">
                                            <div className="flex items-center justify-between">
                                                <span>Letzter Sync</span>
                                                <span className="font-medium text-slate-950">
                                                    {formatDateTime(
                                                        state.last_synced_at,
                                                    )}
                                                </span>
                                            </div>
                                            <div className="flex items-start justify-between gap-3">
                                                <span>Fehler</span>
                                                <span className="text-right font-medium text-slate-950">
                                                    {state.last_error ?? '–'}
                                                </span>
                                            </div>
                                        </div>

                                        <Button
                                            className="w-full rounded-2xl"
                                            disabled={
                                                syncingYear === state.year
                                            }
                                            onClick={() => syncYear(state.year)}
                                            type="button"
                                        >
                                            <RefreshCcwIcon
                                                className={cn(
                                                    syncingYear ===
                                                        state.year &&
                                                        'animate-spin',
                                                )}
                                            />
                                            {syncingYear === state.year
                                                ? 'Synchronisiere...'
                                                : 'Jetzt synchronisieren'}
                                        </Button>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </section>

                    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
                        <Card className="rounded-[2rem] border-white/80 bg-white/90 shadow-[0_20px_55px_rgba(15,23,42,0.06)]">
                            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <CardTitle
                                        className="text-2xl text-slate-950"
                                        style={{
                                            fontFamily: 'var(--font-display)',
                                        }}
                                    >
                                        Transaktionen im Fokus
                                    </CardTitle>
                                    <p className="mt-1 text-sm text-slate-600">
                                        Die neuesten Buchungen aus{' '}
                                        {selectedYearLabel}.
                                    </p>
                                </div>
                                <Button
                                    asChild
                                    className="rounded-full"
                                    variant="secondary"
                                >
                                    <Link
                                        href={transaktionenIndex.url({
                                            query: {
                                                year: selectedYear,
                                            },
                                        })}
                                    >
                                        Vollständige Tabelle
                                    </Link>
                                </Button>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {recentTransactions.length === 0 ? (
                                    <div className="rounded-[1.5rem] bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                                        Keine Transaktionen für den aktuellen
                                        Filter gefunden.
                                    </div>
                                ) : (
                                    recentTransactions.map((transaction) => (
                                        <div
                                            className="grid gap-3 rounded-[1.4rem] bg-slate-50 px-4 py-4 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_8rem_6rem]"
                                            key={transaction.id}
                                        >
                                            <div className="font-medium text-slate-700">
                                                {formatDate(
                                                    transaction.booking_date,
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="truncate font-semibold text-slate-950">
                                                    {transaction.booking_text}
                                                </p>
                                                <p className="truncate text-slate-500">
                                                    {
                                                        transaction.transaction_type
                                                    }
                                                </p>
                                            </div>
                                            <div
                                                className={cn(
                                                    'text-right font-semibold',
                                                    amountTone(transaction),
                                                )}
                                            >
                                                {formatCurrency(
                                                    transaction.amount_cents,
                                                )}
                                            </div>
                                            <div className="text-right text-slate-500">
                                                {transaction.source_year}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </CardContent>
                        </Card>

                        <Card className="rounded-[2rem] border-slate-900/90 bg-[linear-gradient(180deg,#0f172a_0%,#0b1324_100%)] text-white shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
                            <CardHeader>
                                <CardTitle
                                    className="text-2xl"
                                    style={{
                                        fontFamily: 'var(--font-display)',
                                    }}
                                >
                                    Belegstatus
                                </CardTitle>
                                <p className="text-sm leading-6 text-slate-300">
                                    Sofort sichtbar, welche Dokumente fehlen und
                                    was schon aktuell synchronisiert wurde.
                                </p>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="rounded-[1.4rem] bg-white/6 px-4 py-4">
                                    <div className="text-sm text-slate-300">
                                        Fehlende PDFs
                                    </div>
                                    <div
                                        className="mt-3 text-3xl font-semibold text-amber-300"
                                        style={{
                                            fontFamily: 'var(--font-display)',
                                        }}
                                    >
                                        {formatCount(stats.missing_pdf_count)}
                                    </div>
                                </div>
                                <div className="rounded-[1.4rem] bg-white/6 px-4 py-4">
                                    <div className="text-sm text-slate-300">
                                        Ohne Lieferant
                                    </div>
                                    <div
                                        className="mt-3 text-3xl font-semibold text-amber-300"
                                        style={{
                                            fontFamily: 'var(--font-display)',
                                        }}
                                    >
                                        {formatCount(
                                            stats.missing_counterparty_count,
                                        )}
                                    </div>
                                </div>
                                <Button
                                    asChild
                                    className="mt-2 w-full rounded-2xl bg-white text-slate-950 hover:bg-white/90"
                                    size="lg"
                                >
                                    <Link
                                        href={belegeIndex.url({
                                            query: {
                                                year: selectedYear,
                                            },
                                        })}
                                    >
                                        Belege öffnen
                                    </Link>
                                </Button>
                            </CardContent>
                        </Card>
                    </section>

                    <section>
                        <Card className="rounded-[2rem] border-white/80 bg-white/90 shadow-[0_20px_55px_rgba(15,23,42,0.06)]">
                            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <CardTitle
                                        className="text-2xl text-slate-950"
                                        style={{
                                            fontFamily: 'var(--font-display)',
                                        }}
                                    >
                                        Neueste Belege
                                    </CardTitle>
                                    <p className="mt-1 text-sm text-slate-600">
                                        Zuletzt erfasste Dokumente und ihr
                                        PDF-Status.
                                    </p>
                                </div>
                                <Button
                                    asChild
                                    className="rounded-full"
                                    variant="secondary"
                                >
                                    <Link
                                        href={belegeIndex.url({
                                            query: {
                                                year: selectedYear,
                                            },
                                        })}
                                    >
                                        Zur Belegliste
                                    </Link>
                                </Button>
                            </CardHeader>
                            <CardContent className="grid gap-3 lg:grid-cols-2">
                                {recentBelege.length === 0 ? (
                                    <div className="rounded-[1.5rem] bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 lg:col-span-2">
                                        Keine Belege für den aktuellen Filter
                                        gefunden.
                                    </div>
                                ) : (
                                    recentBelege.map((beleg) => (
                                        <div
                                            className="rounded-[1.5rem] bg-slate-50 px-4 py-4"
                                            key={beleg.id}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="truncate font-semibold text-slate-950">
                                                        {beleg.issuer_name ??
                                                            'Unbekannter Lieferant'}
                                                    </p>
                                                    <p className="mt-1 truncate text-sm text-slate-500">
                                                        {beleg.subject ??
                                                            beleg.summary_short ??
                                                            beleg.target_basename}
                                                    </p>
                                                </div>
                                                <Badge
                                                    className={cn(
                                                        'rounded-full',
                                                        beleg.pdf_available
                                                            ? 'bg-emerald-100 text-emerald-800'
                                                            : 'bg-amber-100 text-amber-800',
                                                    )}
                                                    variant="secondary"
                                                >
                                                    {beleg.pdf_available
                                                        ? 'PDF'
                                                        : 'fehlt'}
                                                </Badge>
                                            </div>
                                            <Separator className="my-4" />
                                            <div className="flex items-center justify-between text-sm text-slate-600">
                                                <span>
                                                    {formatDate(
                                                        beleg.document_date,
                                                    )}
                                                </span>
                                                <span className="font-medium text-slate-950">
                                                    {formatCurrency(
                                                        beleg.gross_amount_cents,
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </CardContent>
                        </Card>
                    </section>
                </div>
            </AppShell>
        </>
    );
}
