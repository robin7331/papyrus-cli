import { Head, router } from '@inertiajs/react';
import { ArrowUpDownIcon, SearchIcon } from 'lucide-react';
import type { FormEvent, KeyboardEvent } from 'react';
import { transaction as transactionShow } from '@/actions/App/Http/Controllers/DashboardController';
import { AppShell } from '@/components/app-shell';
import { TablePagination } from '@/components/table-pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import {
    formatCount,
    formatCurrency,
    formatDate,
    formatYearLabel,
} from '@/lib/bookkeeping';
import { cn } from '@/lib/utils';
import { index as transaktionenIndex } from '@/routes/transaktionen';
import type {
    SortDirection,
    TransactionSortKey,
    TransactionsPageProps,
} from '@/types';

type TransactionsQuery = {
    year: string;
    search?: string;
    exact_amount?: string;
    sort: TransactionSortKey;
    dir: SortDirection;
    page: number;
};

function sortLabel(active: boolean, direction: SortDirection): string {
    if (!active) {
        return '';
    }

    return direction === 'asc' ? ' aufsteigend' : ' absteigend';
}

function associationBadgeClassName(isAssociated: boolean): string {
    return isAssociated
        ? 'bg-emerald-100 text-emerald-800'
        : 'bg-amber-100 text-amber-800';
}

export default function Transaktionen({
    availableYears,
    selectedYear,
    filters,
    summary,
    transactions,
}: TransactionsPageProps) {
    const baseQuery = (): TransactionsQuery => ({
        year: filters.year,
        search: filters.search || undefined,
        exact_amount: filters.exact_amount || undefined,
        sort: filters.sort,
        dir: filters.dir,
        page: transactions.current_page,
    });

    const visitWithQuery = (nextQuery: Partial<TransactionsQuery>) => {
        router.visit(
            transaktionenIndex({
                query: {
                    ...baseQuery(),
                    ...nextQuery,
                },
            }),
            {
                preserveScroll: true,
                preserveState: true,
                replace: true,
            },
        );
    };

    const submitSearch = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const formData = new FormData(event.currentTarget);

        visitWithQuery({
            search: String(formData.get('search') ?? '') || undefined,
            exact_amount:
                String(formData.get('exact_amount') ?? '') || undefined,
            page: 1,
        });
    };

    const openTransaction = (transactionId: number) => {
        router.visit(
            transactionShow(transactionId, {
                query: baseQuery(),
            }),
        );
    };

    const handleTransactionKeyDown = (
        event: KeyboardEvent<HTMLTableRowElement>,
        transactionId: number,
    ) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();

        openTransaction(transactionId);
    };

    const changeSort = (sort: TransactionSortKey) => {
        const nextDirection: SortDirection =
            filters.sort === sort && filters.dir === 'asc' ? 'desc' : 'asc';

        visitWithQuery({
            sort,
            dir: nextDirection,
            page: 1,
        });
    };

    return (
        <>
            <Head title="Transaktionen" />

            <AppShell>
                <div className="space-y-6 pb-10">
                    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                        <Card className="overflow-hidden rounded-[2rem] border-slate-900/90 bg-[linear-gradient(140deg,#16324f_0%,#0f172a_55%,#111827_100%)] text-white shadow-[0_30px_90px_rgba(22,50,79,0.18)]">
                            <CardContent className="flex h-full flex-col gap-8 px-6 py-7 sm:px-8 sm:py-8">
                                <div className="space-y-5">
                                    <Badge className="w-fit rounded-full border-white/15 bg-white/10 text-white hover:bg-white/10">
                                        Transaktionen
                                    </Badge>
                                    <div className="space-y-3">
                                        <h1
                                            className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
                                            style={{
                                                fontFamily:
                                                    'var(--font-display)',
                                            }}
                                        >
                                            Vollständige Bewegungen für{' '}
                                            {formatYearLabel(selectedYear)}.
                                        </h1>
                                        <p className="max-w-3xl text-lg leading-8 text-slate-200">
                                            Suche, Sortierung und Pagination
                                            laufen jetzt in einer eigenen
                                            Ansicht mit Detailansicht pro
                                            Buchung und sichtbarem
                                            Zuordnungsstatus.
                                        </p>
                                    </div>
                                </div>

                                <form
                                    className="grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)_12rem_auto]"
                                    onSubmit={submitSearch}
                                >
                                    <Select
                                        onValueChange={(year) =>
                                            visitWithQuery({
                                                year,
                                                page: 1,
                                            })
                                        }
                                        value={filters.year}
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

                                    <div className="relative">
                                        <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-slate-300" />
                                        <Input
                                            className="h-11 rounded-2xl border-white/15 bg-white/10 pl-11 text-white placeholder:text-slate-300"
                                            defaultValue={filters.search}
                                            name="search"
                                            placeholder="Buchungstext, Typ oder Konto durchsuchen"
                                        />
                                    </div>

                                    <Input
                                        className="h-11 rounded-2xl border-white/15 bg-white/10 text-right text-white placeholder:text-slate-300 tabular-nums"
                                        defaultValue={filters.exact_amount}
                                        inputMode="decimal"
                                        name="exact_amount"
                                        placeholder="Exakter Betrag"
                                    />

                                    <Button
                                        className="h-11 rounded-2xl bg-white px-5 text-slate-950 hover:bg-white/90"
                                        type="submit"
                                    >
                                        Filtern
                                    </Button>
                                </form>
                            </CardContent>
                        </Card>

                        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
                            <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                        Einträge
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div
                                        className="text-4xl font-semibold tracking-tight text-slate-950"
                                        style={{
                                            fontFamily: 'var(--font-display)',
                                        }}
                                    >
                                        {formatCount(summary.total_count)}
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                        Eingänge
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-semibold text-emerald-700">
                                        {formatCurrency(
                                            summary.credit_total_cents,
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                        Ausgänge
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-semibold text-rose-700">
                                        {formatCurrency(
                                            summary.debit_total_cents,
                                        )}
                                    </div>
                                    <p className="mt-2 text-xs tracking-[0.18em] text-slate-500 uppercase">
                                        Letzte Buchung{' '}
                                        {formatDate(
                                            summary.latest_booking_date,
                                        )}
                                    </p>
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
                                Transaktionstabelle
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-0 pb-0">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-b border-border/70 bg-slate-50/80">
                                        <TableHead className="px-6">
                                            <button
                                                className="inline-flex items-center gap-2 font-semibold"
                                                onClick={() =>
                                                    changeSort('booking_date')
                                                }
                                                type="button"
                                            >
                                                Datum
                                                <ArrowUpDownIcon className="size-4" />
                                                <span className="sr-only">
                                                    {sortLabel(
                                                        filters.sort ===
                                                            'booking_date',
                                                        filters.dir,
                                                    )}
                                                </span>
                                            </button>
                                        </TableHead>
                                        <TableHead>Beschreibung</TableHead>
                                        <TableHead>Konto</TableHead>
                                        <TableHead className="text-right">
                                            <button
                                                className="inline-flex items-center gap-2 font-semibold"
                                                onClick={() =>
                                                    changeSort('amount_cents')
                                                }
                                                type="button"
                                            >
                                                Betrag
                                                <ArrowUpDownIcon className="size-4" />
                                            </button>
                                        </TableHead>
                                        <TableHead className="text-right">
                                            <button
                                                className="inline-flex items-center gap-2 font-semibold"
                                                onClick={() =>
                                                    changeSort(
                                                        'balance_after_cents',
                                                    )
                                                }
                                                type="button"
                                            >
                                                Saldo
                                                <ArrowUpDownIcon className="size-4" />
                                            </button>
                                        </TableHead>
                                        <TableHead className="text-right">
                                            Jahr
                                        </TableHead>
                                        <TableHead className="text-right">
                                            Zuordnung
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {transactions.data.map((transaction) => (
                                        <TableRow
                                            className="cursor-pointer transition-colors hover:bg-slate-50/80 focus-visible:bg-slate-50/80"
                                            key={transaction.id}
                                            onClick={() =>
                                                openTransaction(transaction.id)
                                            }
                                            onKeyDown={(event) =>
                                                handleTransactionKeyDown(
                                                    event,
                                                    transaction.id,
                                                )
                                            }
                                            tabIndex={0}
                                        >
                                            <TableCell className="px-6 py-4 font-medium text-slate-700">
                                                {formatDate(
                                                    transaction.booking_date,
                                                )}
                                            </TableCell>
                                            <TableCell className="py-4">
                                                <div className="space-y-1">
                                                    <div className="font-semibold text-slate-950">
                                                        {
                                                            transaction.booking_text
                                                        }
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                                        <Badge
                                                            className="rounded-full"
                                                            variant="secondary"
                                                        >
                                                            {
                                                                transaction.transaction_type
                                                            }
                                                        </Badge>
                                                        <span>
                                                            {
                                                                transaction.statement_no
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-4 text-slate-600">
                                                {transaction.account_number}
                                            </TableCell>
                                            <TableCell
                                                className={cn(
                                                    'py-4 text-right font-semibold tabular-nums',
                                                    transaction.amount_cents >=
                                                        0
                                                        ? 'text-emerald-700'
                                                        : 'text-rose-700',
                                                )}
                                            >
                                                {formatCurrency(
                                                    transaction.amount_cents,
                                                )}
                                            </TableCell>
                                            <TableCell className="py-4 text-right font-medium text-slate-700 tabular-nums">
                                                {formatCurrency(
                                                    transaction.balance_after_cents,
                                                )}
                                            </TableCell>
                                            <TableCell className="py-4 text-right text-slate-500">
                                                {transaction.source_year}
                                            </TableCell>
                                            <TableCell className="py-4 text-right">
                                                <div className="flex flex-col items-end gap-1">
                                                    <Badge
                                                        className={cn(
                                                            'rounded-full',
                                                            associationBadgeClassName(
                                                                transaction.is_associated,
                                                            ),
                                                        )}
                                                        variant="secondary"
                                                    >
                                                        {transaction.is_associated
                                                            ? 'zugeordnet'
                                                            : 'offen'}
                                                    </Badge>
                                                    <span className="text-xs text-slate-500">
                                                        {transaction.belege_count}{' '}
                                                        {transaction.belege_count ===
                                                        1
                                                            ? 'Beleg'
                                                            : 'Belege'}
                                                    </span>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>

                            <TablePagination
                                currentPage={transactions.current_page}
                                from={transactions.from}
                                lastPage={transactions.last_page}
                                onPageChange={(page) =>
                                    visitWithQuery({ page })
                                }
                                to={transactions.to}
                                total={transactions.total}
                            />
                        </CardContent>
                    </Card>
                </div>
            </AppShell>
        </>
    );
}
