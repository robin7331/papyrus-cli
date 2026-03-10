import { Head, Link, router, usePage } from '@inertiajs/react';
import {
    ArrowLeftIcon,
    ExternalLinkIcon,
    Link2Icon,
    Link2OffIcon,
} from 'lucide-react';
import TransactionBelegAssociationController from '@/actions/App/Http/Controllers/TransactionBelegAssociationController';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    formatCurrency,
    formatDate,
    formatYearLabel,
} from '@/lib/bookkeeping';
import { cn } from '@/lib/utils';
import {
    index as belegeIndex,
    pdf as belegPdf,
} from '@/routes/belege';
import { show as transactionShow } from '@/routes/transaktionen';
import type {
    BelegAssociationTransactionRow,
    BelegDetailPageProps,
    FlashProps,
} from '@/types';

function associationBadgeClassName(isAssociated: boolean): string {
    return isAssociated
        ? 'bg-emerald-100 text-emerald-800'
        : 'bg-amber-100 text-amber-800';
}

function dayOffsetLabel(daysOffset: number | null): string {
    if (daysOffset === null) {
        return 'ohne Datum';
    }

    if (daysOffset === 0) {
        return 'gleicher Tag';
    }

    if (daysOffset > 0) {
        return `+${daysOffset} Tage`;
    }

    return `${daysOffset} Tage`;
}

function TransactionAssociationCard({
    transaction,
    onAssociate,
    onDetach,
}: {
    transaction: BelegAssociationTransactionRow;
    onAssociate: (transactionId: number) => void;
    onDetach: (transactionId: number) => void;
}) {
    return (
        <article className="rounded-[1.6rem] border border-slate-200/80 bg-white/90 p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge
                            className={cn(
                                'rounded-full',
                                associationBadgeClassName(
                                    transaction.is_associated,
                                ),
                            )}
                            variant="secondary"
                        >
                            {transaction.is_associated ? 'zugeordnet' : 'offen'}
                        </Badge>
                        <Badge className="rounded-full" variant="outline">
                            {dayOffsetLabel(transaction.days_offset)}
                        </Badge>
                        <Badge className="rounded-full" variant="outline">
                            {transaction.transaction_type}
                        </Badge>
                    </div>

                    <div className="space-y-1">
                        <h2 className="text-lg font-semibold text-slate-950">
                            {transaction.booking_text}
                        </h2>
                        <p className="text-sm text-slate-600">
                            Konto {transaction.account_number} · Auszug{' '}
                            {transaction.statement_no}
                        </p>
                    </div>

                    <dl className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                        <div>
                            <dt className="text-xs tracking-[0.18em] text-slate-500 uppercase">
                                Datum
                            </dt>
                            <dd className="mt-1 font-medium text-slate-900">
                                {formatDate(transaction.booking_date)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs tracking-[0.18em] text-slate-500 uppercase">
                                Betrag
                            </dt>
                            <dd className="mt-1 font-medium text-slate-900">
                                {formatCurrency(transaction.amount_cents)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs tracking-[0.18em] text-slate-500 uppercase">
                                Zugeordnete Belege
                            </dt>
                            <dd className="mt-1 font-medium text-slate-900">
                                {transaction.belege_count}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs tracking-[0.18em] text-slate-500 uppercase">
                                Detail
                            </dt>
                            <dd className="mt-1">
                                <Link
                                    className="font-medium text-sky-700 hover:text-sky-900"
                                    href={transactionShow.url({
                                        importedTransaction: transaction.id,
                                    })}
                                >
                                    Transaktion öffnen
                                </Link>
                            </dd>
                        </div>
                    </dl>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                        className="rounded-full"
                        onClick={() =>
                            transaction.is_associated
                                ? onDetach(transaction.id)
                                : onAssociate(transaction.id)
                        }
                        variant={
                            transaction.is_associated ? 'outline' : 'default'
                        }
                    >
                        {transaction.is_associated ? (
                            <>
                                Lösen
                                <Link2OffIcon />
                            </>
                        ) : (
                            <>
                                Zuordnen
                                <Link2Icon />
                            </>
                        )}
                    </Button>
                </div>
            </div>
        </article>
    );
}

export default function BelegShow({
    indexState,
    beleg,
    dateWindow,
    nearbyTransactions,
    associatedTransactionsOutsideWindow,
}: BelegDetailPageProps) {
    const { flash } = usePage<{ flash: FlashProps }>().props;

    const backHref = belegeIndex.url({
        query: {
            year: indexState.year,
            search: indexState.search || undefined,
            exact_amount: indexState.exact_amount || undefined,
            sort: indexState.sort,
            dir: indexState.dir,
            page: indexState.page,
        },
    });

    const associateTransaction = (transactionId: number) => {
        router.visit(
            TransactionBelegAssociationController.store(transactionId),
            {
                data: {
                    imported_beleg_id: beleg.id,
                },
                method: 'post',
                preserveScroll: true,
            },
        );
    };

    const detachTransaction = (transactionId: number) => {
        router.visit(
            TransactionBelegAssociationController.destroy([
                transactionId,
                beleg.id,
            ]),
            {
                method: 'delete',
                preserveScroll: true,
            },
        );
    };

    return (
        <>
            <Head title={`Beleg ${beleg.id}`} />

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

                    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
                        <Card className="overflow-hidden rounded-[2rem] border-white/80 bg-white/90 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
                            <CardContent className="space-y-8 px-6 py-7 sm:px-8 sm:py-8">
                                <div className="flex flex-wrap items-center gap-3">
                                    <Badge className="rounded-full bg-slate-900 text-white hover:bg-slate-900">
                                        Belegdetail
                                    </Badge>
                                    <Badge
                                        className={cn(
                                            'rounded-full',
                                            associationBadgeClassName(
                                                beleg.is_associated,
                                            ),
                                        )}
                                        variant="secondary"
                                    >
                                        {beleg.is_associated
                                            ? 'zugeordnet'
                                            : 'offen'}
                                    </Badge>
                                </div>

                                <div className="space-y-4">
                                    <Button
                                        asChild
                                        className="rounded-full"
                                        variant="outline"
                                    >
                                        <Link href={backHref}>
                                            <ArrowLeftIcon />
                                            Zurück zur Liste
                                        </Link>
                                    </Button>

                                    <div className="space-y-3">
                                        <h1
                                            className="text-4xl font-semibold tracking-tight text-balance text-slate-950 sm:text-5xl"
                                            style={{
                                                fontFamily:
                                                    'var(--font-display)',
                                            }}
                                        >
                                            {beleg.issuer_name ??
                                                beleg.subject ??
                                                beleg.target_basename}
                                        </h1>
                                        <p className="max-w-3xl text-lg leading-8 text-slate-600">
                                            Passende Transaktionen für{' '}
                                            {formatDate(beleg.document_date)} im
                                            Fenster von {dateWindow.days} Tagen
                                            vor und nach dem Belegdatum.
                                        </p>
                                    </div>
                                </div>

                                <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                                        <dt className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                            Betrag
                                        </dt>
                                        <dd className="mt-2 text-2xl font-semibold text-slate-950">
                                            {formatCurrency(
                                                beleg.gross_amount_cents,
                                            )}
                                        </dd>
                                    </div>
                                    <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                                        <dt className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                            Belegdatum
                                        </dt>
                                        <dd className="mt-2 text-2xl font-semibold text-slate-950">
                                            {formatDate(beleg.document_date)}
                                        </dd>
                                    </div>
                                    <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                                        <dt className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                            Jahr
                                        </dt>
                                        <dd className="mt-2 text-lg font-semibold text-slate-950">
                                            {formatYearLabel(
                                                String(beleg.source_year),
                                            )}
                                        </dd>
                                    </div>
                                    <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                                        <dt className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                            Zugeordnete Transaktionen
                                        </dt>
                                        <dd className="mt-2 text-2xl font-semibold text-slate-950">
                                            {beleg.transactions_count}
                                        </dd>
                                    </div>
                                </dl>

                                <div className="flex flex-wrap gap-2">
                                    {beleg.pdf_available && (
                                        <Button
                                            asChild
                                            className="rounded-full"
                                            variant="outline"
                                        >
                                            <a
                                                href={belegPdf.url({
                                                    importedBeleg: beleg.id,
                                                })}
                                                rel="noreferrer"
                                                target="_blank"
                                            >
                                                PDF
                                                <ExternalLinkIcon />
                                            </a>
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                            <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                        Zeitraum
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <div className="text-xl font-semibold text-slate-950">
                                        {formatDate(dateWindow.from)}
                                    </div>
                                    <div className="text-sm text-slate-500">
                                        bis {formatDate(dateWindow.to)}
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                        Listenfilter
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm text-slate-600">
                                    <div>Jahr: {formatYearLabel(indexState.year)}</div>
                                    <div>Suche: {indexState.search || '–'}</div>
                                    <div>
                                        Exakter Betrag:{' '}
                                        {indexState.exact_amount || '–'}
                                    </div>
                                    <div>Seite: {indexState.page}</div>
                                </CardContent>
                            </Card>
                        </div>
                    </section>

                    <Card className="overflow-hidden rounded-[2rem] border-white/80 bg-white/90 shadow-[0_20px_55px_rgba(15,23,42,0.06)]">
                        <CardHeader className="pb-4">
                            <CardTitle
                                className="text-2xl text-slate-950"
                                style={{ fontFamily: 'var(--font-display)' }}
                            >
                                Transaktionen im Zeitraum
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {nearbyTransactions.length === 0 ? (
                                <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center text-sm text-slate-500">
                                    Im Zeitraum wurden keine Transaktionen gefunden.
                                </div>
                            ) : (
                                nearbyTransactions.map((transaction) => (
                                    <TransactionAssociationCard
                                        key={transaction.id}
                                        onAssociate={associateTransaction}
                                        onDetach={detachTransaction}
                                        transaction={transaction}
                                    />
                                ))
                            )}
                        </CardContent>
                    </Card>

                    {associatedTransactionsOutsideWindow.length > 0 && (
                        <Card className="overflow-hidden rounded-[2rem] border-white/80 bg-white/90 shadow-[0_20px_55px_rgba(15,23,42,0.06)]">
                            <CardHeader className="pb-4">
                                <CardTitle
                                    className="text-2xl text-slate-950"
                                    style={{ fontFamily: 'var(--font-display)' }}
                                >
                                    Bereits zugeordnet außerhalb des Fensters
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {associatedTransactionsOutsideWindow.map(
                                    (transaction) => (
                                        <TransactionAssociationCard
                                            key={transaction.id}
                                            onAssociate={associateTransaction}
                                            onDetach={detachTransaction}
                                            transaction={transaction}
                                        />
                                    ),
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>
            </AppShell>
        </>
    );
}
