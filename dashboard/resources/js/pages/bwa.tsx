import { Head, Link, router } from '@inertiajs/react';
import {
    AlertTriangleIcon,
    LandmarkIcon,
    ScaleIcon,
    WalletCardsIcon,
} from 'lucide-react';
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { formatCount, formatCurrency, formatDate } from '@/lib/bookkeeping';
import { cn } from '@/lib/utils';
import { index as bwaIndex } from '@/routes/bwa';
import { preview as bwaPreview } from '@/routes/bwa';
import type {
    BwaEstimateBucket,
    BwaEstimatePageProps,
    BwaEstimateProfitStatus,
} from '@/types';

function bucketClassName(bucket: BwaEstimateBucket): string {
    if (bucket === 'operating_inflow') {
        return 'bg-emerald-100 text-emerald-800';
    }

    if (bucket === 'operating_outflow') {
        return 'bg-slate-200 text-slate-800';
    }

    if (bucket === 'separate_tax_payment') {
        return 'bg-amber-100 text-amber-900';
    }

    return 'bg-rose-100 text-rose-800';
}

function profitTone(status: BwaEstimateProfitStatus): string {
    if (status === 'profit') {
        return 'text-emerald-700';
    }

    if (status === 'loss') {
        return 'text-rose-700';
    }

    return 'text-slate-700';
}

function profitLabel(status: BwaEstimateProfitStatus): string {
    if (status === 'profit') {
        return 'Gewinn wahrscheinlich';
    }

    if (status === 'loss') {
        return 'Verlust wahrscheinlich';
    }

    return 'Voraussichtlich ausgeglichen';
}

export default function Bwa({
    availableYears,
    selectedYear,
    estimateLabel,
    methodologyNotes,
    summary,
    months,
    transactions,
}: BwaEstimatePageProps) {
    const changeYear = (year: string) => {
        router.visit(
            bwaIndex({
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

    return (
        <>
            <Head title="BWA-Schätzung" />

            <AppShell>
                <div className="space-y-6 pb-10">
                    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                        <Card className="overflow-hidden rounded-[2rem] border-emerald-950/90 bg-[linear-gradient(145deg,#0f3b36_0%,#0f172a_55%,#111827_100%)] text-white shadow-[0_30px_90px_rgba(15,118,110,0.20)]">
                            <CardContent className="space-y-8 px-6 py-7 sm:px-8 sm:py-8">
                                <div className="space-y-5">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <Badge className="rounded-full border-white/15 bg-white/10 text-white hover:bg-white/10">
                                            BWA-Schätzung
                                        </Badge>
                                        <Badge className="rounded-full border-amber-300/25 bg-amber-300/10 text-amber-100 hover:bg-amber-300/10">
                                            {estimateLabel}
                                        </Badge>
                                    </div>

                                    <div className="space-y-3">
                                        <h1
                                            className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
                                            style={{
                                                fontFamily:
                                                    'var(--font-display)',
                                            }}
                                        >
                                            Konservative USt-Last und grobes
                                            Ergebnis aus den Kontobewegungen.
                                        </h1>
                                        <p className="max-w-3xl text-lg leading-8 text-emerald-50/85">
                                            Die Seite rechnet mit festen
                                            Quoten: 72,7 % der betrieblichen
                                            Eingänge und 89,2 % der
                                            betrieblichen Ausgänge werden als
                                            19-%-USt-haltig behandelt.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
                                    <div className="flex flex-col gap-3 lg:flex-row">
                                        <div className="w-full lg:max-w-64">
                                            <Select
                                                onValueChange={changeYear}
                                                value={
                                                    selectedYear === null
                                                        ? undefined
                                                        : String(selectedYear)
                                                }
                                            >
                                                <SelectTrigger className="h-11 w-full rounded-2xl border-white/15 bg-white/10 text-white">
                                                    <SelectValue placeholder="Jahr wählen" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {availableYears.map(
                                                        (year) => (
                                                            <SelectItem
                                                                key={year}
                                                                value={String(
                                                                    year,
                                                                )}
                                                            >
                                                                {year}
                                                            </SelectItem>
                                                        ),
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <Button
                                            asChild
                                            className="h-11 rounded-2xl border-white/15 bg-white/10 px-5 text-white hover:bg-white/15"
                                            variant="outline"
                                        >
                                            <Link
                                                href={bwaPreview({
                                                    query: selectedYear
                                                        ? {
                                                              year: selectedYear,
                                                          }
                                                        : undefined,
                                                })}
                                            >
                                                BWA Vorschau
                                            </Link>
                                        </Button>
                                    </div>

                                    {summary !== null && (
                                        <div className="flex flex-wrap items-center gap-3 rounded-[1.4rem] border border-white/10 bg-white/8 px-4 py-3">
                                            <ScaleIcon className="size-5 text-amber-200" />
                                            <div>
                                                <p className="text-xs tracking-[0.2em] text-emerald-50/70 uppercase">
                                                    Operatives Kernergebnis
                                                </p>
                                                <p
                                                    className={cn(
                                                        'text-lg font-semibold',
                                                        profitTone(
                                                            summary.profit_status,
                                                        ),
                                                    )}
                                                >
                                                    {profitLabel(
                                                        summary.profit_status,
                                                    )}{' '}
                                                    mit{' '}
                                                    {formatCurrency(
                                                        summary.estimated_operating_profit_cents,
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                            <Card className="rounded-[1.8rem] border-amber-200/70 bg-amber-50/85 shadow-[0_20px_55px_rgba(245,158,11,0.12)]">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-xs tracking-[0.24em] text-amber-900/80 uppercase">
                                        Methodik
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3 text-sm leading-6 text-amber-950">
                                    {methodologyNotes.map((note) => (
                                        <div
                                            className="flex gap-3"
                                            key={note}
                                        >
                                            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-700" />
                                            <p>{note}</p>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>

                            <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                        Bewegungen
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-1">
                                    <div
                                        className="text-4xl font-semibold tracking-tight text-slate-950"
                                        style={{
                                            fontFamily: 'var(--font-display)',
                                        }}
                                    >
                                        {formatCount(
                                            summary?.total_transaction_count ??
                                                0,
                                        )}
                                    </div>
                                    <p className="text-sm text-slate-600">
                                        {formatCount(
                                            summary?.operating_transaction_count ??
                                                0,
                                        )}{' '}
                                        operative Bewegungen im Modell.
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    </section>

                    {summary === null ? (
                        <Card className="rounded-[2rem] border-dashed border-slate-300 bg-white/70">
                            <CardContent className="flex min-h-56 items-center justify-center p-8 text-center text-slate-600">
                                Keine Jahresdaten mit importierten
                                Transaktionen vorhanden.
                            </CardContent>
                        </Card>
                    ) : (
                        <>
                            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                            Eingänge brutto
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        <div className="flex items-center gap-3">
                                            <LandmarkIcon className="size-5 text-emerald-700" />
                                            <div className="text-2xl font-semibold text-emerald-700">
                                                {formatCurrency(
                                                    summary.operating_inflow_gross_cents,
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-sm text-slate-600">
                                            Alle verbleibenden positiven
                                            Buchungen als Bruttoerlöse.
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                            Konservative USt-Last
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        <div className="text-2xl font-semibold text-amber-700">
                                            {formatCurrency(
                                                summary.estimated_net_vat_payable_cents,
                                            )}
                                        </div>
                                        <p className="text-sm text-slate-600">
                                            Ausgangs-USt abzüglich
                                            Vorsteuerquote.
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                            Nettoerlöse
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        <div className="text-2xl font-semibold text-slate-950">
                                            {formatCurrency(
                                                summary.assumed_revenue_net_cents,
                                            )}
                                        </div>
                                        <p className="text-sm text-slate-600">
                                            Bruttoeingänge abzüglich
                                            konservativer Umsatzsteuer.
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                            Ausgänge brutto
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        <div className="text-2xl font-semibold text-slate-950">
                                            {formatCurrency(
                                                summary.operating_outflow_gross_cents,
                                            )}
                                        </div>
                                        <p className="text-sm text-slate-600">
                                            Alle verbleibenden negativen
                                            Buchungen als Bruttoaufwand.
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                            Vorsteuerquote
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        <div className="text-2xl font-semibold text-sky-700">
                                            {formatCurrency(
                                                summary.assumed_input_vat_cents,
                                            )}
                                        </div>
                                        <p className="text-sm text-slate-600">
                                            {formatCount(
                                                summary.input_vat_transaction_count,
                                            )}{' '}
                                            operative Ausgänge mit
                                            Vorsteuerquote.
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                            Nettoaufwand
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        <div className="text-2xl font-semibold text-slate-950">
                                            {formatCurrency(
                                                summary.assumed_expense_net_cents,
                                            )}
                                        </div>
                                        <p className="text-sm text-slate-600">
                                            Bruttoausgänge abzüglich
                                            Vorsteuerquote.
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                            Steuerbewegungen separat
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        <div className="flex items-center gap-3">
                                            <WalletCardsIcon className="size-5 text-amber-700" />
                                            <div className="text-2xl font-semibold text-amber-700">
                                                {formatCurrency(
                                                    summary.separate_tax_movement_cents,
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-sm text-slate-600">
                                            {formatCount(
                                                summary.separate_tax_transaction_count,
                                            )}{' '}
                                            erkannte Steuerbewegungen außerhalb
                                            des Kernergebnisses.
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                            Ausgeschlossene Bewegungen
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        <div className="text-2xl font-semibold text-rose-700">
                                            {formatCurrency(
                                                summary.excluded_net_movement_cents,
                                            )}
                                        </div>
                                        <p className="text-sm text-slate-600">
                                            {formatCount(
                                                summary.excluded_transaction_count,
                                            )}{' '}
                                            Privat- oder
                                            Finanzierungsbewegungen.
                                        </p>
                                    </CardContent>
                                </Card>
                            </section>

                            <Card className="overflow-hidden rounded-[2rem] border-white/80 bg-white/90 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
                                <CardHeader className="pb-4">
                                    <CardTitle>
                                        Monatsbild für {selectedYear}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="px-0 pb-0">
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="pl-6">
                                                        Monat
                                                    </TableHead>
                                                    <TableHead>
                                                        Bewegungen
                                                    </TableHead>
                                                    <TableHead className="text-right">
                                                        Eingänge
                                                    </TableHead>
                                                    <TableHead className="text-right">
                                                        Ausgangs-USt
                                                    </TableHead>
                                                    <TableHead className="text-right">
                                                        Vorsteuer
                                                    </TableHead>
                                                    <TableHead className="text-right">
                                                        USt netto
                                                    </TableHead>
                                                    <TableHead className="text-right">
                                                        Netto
                                                    </TableHead>
                                                    <TableHead className="text-right">
                                                        Ausgänge
                                                    </TableHead>
                                                    <TableHead className="text-right">
                                                        Aufwand netto
                                                    </TableHead>
                                                    <TableHead className="text-right">
                                                        Ergebnis
                                                    </TableHead>
                                                    <TableHead className="pr-6 text-right">
                                                        Steuern separat
                                                    </TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {months.map((month) => (
                                                    <TableRow
                                                        key={month.month}
                                                    >
                                                        <TableCell className="pl-6 font-medium">
                                                            {month.label}
                                                        </TableCell>
                                                        <TableCell>
                                                            {formatCount(
                                                                month.transaction_count,
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium text-emerald-700">
                                                            {formatCurrency(
                                                                month.operating_inflow_gross_cents,
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right text-amber-700">
                                                            {formatCurrency(
                                                                month.assumed_output_vat_cents,
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right text-sky-700">
                                                            {formatCurrency(
                                                                month.assumed_input_vat_cents,
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium text-amber-700">
                                                            {formatCurrency(
                                                                month.estimated_net_vat_payable_cents,
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {formatCurrency(
                                                                month.assumed_revenue_net_cents,
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {formatCurrency(
                                                                month.operating_outflow_gross_cents,
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {formatCurrency(
                                                                month.assumed_expense_net_cents,
                                                            )}
                                                        </TableCell>
                                                        <TableCell
                                                            className={cn(
                                                                'text-right font-semibold',
                                                                month.estimated_operating_profit_cents >=
                                                                    0
                                                                    ? 'text-emerald-700'
                                                                    : 'text-rose-700',
                                                            )}
                                                        >
                                                            {formatCurrency(
                                                                month.estimated_operating_profit_cents,
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="pr-6 text-right text-amber-700">
                                                            {formatCurrency(
                                                                month.separate_tax_movement_cents,
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="overflow-hidden rounded-[2rem] border-white/80 bg-white/90 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
                                <CardHeader className="pb-4">
                                    <CardTitle>
                                        Klassifizierte Transaktionen
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="px-0 pb-0">
                                    <div className="max-h-[38rem] overflow-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="pl-6">
                                                        Datum
                                                    </TableHead>
                                                    <TableHead>
                                                        Buchung
                                                    </TableHead>
                                                    <TableHead>
                                                        Typ
                                                    </TableHead>
                                                    <TableHead className="text-right">
                                                        Betrag
                                                    </TableHead>
                                                    <TableHead className="text-right">
                                                        Vorsteuer
                                                    </TableHead>
                                                    <TableHead>
                                                        Bucket
                                                    </TableHead>
                                                    <TableHead className="pr-6">
                                                        Begründung
                                                    </TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {transactions.map(
                                                    (transaction) => (
                                                        <TableRow
                                                            key={transaction.id}
                                                        >
                                                            <TableCell className="pl-6 align-top">
                                                                {formatDate(
                                                                    transaction.booking_date,
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="min-w-80 align-top">
                                                                <div className="space-y-1">
                                                                    <p className="font-medium text-slate-950">
                                                                        {
                                                                            transaction.booking_text
                                                                        }
                                                                    </p>
                                                                    <p className="text-xs text-slate-500">
                                                                        {
                                                                            transaction.statement_no
                                                                        }{' '}
                                                                        ·{' '}
                                                                        {
                                                                            transaction.account_number
                                                                        }
                                                                    </p>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="align-top text-slate-600">
                                                                {
                                                                    transaction.transaction_type
                                                                }
                                                            </TableCell>
                                                            <TableCell
                                                                className={cn(
                                                                    'text-right align-top font-semibold',
                                                                    transaction.amount_cents >=
                                                                        0
                                                                        ? 'text-emerald-700'
                                                                        : 'text-slate-950',
                                                                )}
                                                            >
                                                                {formatCurrency(
                                                                    transaction.amount_cents,
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="text-right align-top text-sky-700">
                                                                {formatCurrency(
                                                                    transaction.assumed_input_vat_cents,
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="align-top">
                                                                <Badge
                                                                    className={cn(
                                                                        'rounded-full',
                                                                        bucketClassName(
                                                                            transaction.bucket,
                                                                        ),
                                                                    )}
                                                                >
                                                                    {
                                                                        transaction.bucket_label
                                                                    }
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell className="pr-6 align-top text-slate-600">
                                                                {
                                                                    transaction.classification_reason
                                                                }
                                                            </TableCell>
                                                        </TableRow>
                                                    ),
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>
                            </Card>
                        </>
                    )}
                </div>
            </AppShell>
        </>
    );
}
