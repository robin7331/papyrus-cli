import { Head, router } from '@inertiajs/react';
import { ArrowUpDownIcon, ExternalLinkIcon, SearchIcon } from 'lucide-react';
import type { FormEvent, KeyboardEvent } from 'react';
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
import {
    index as belegeIndex,
    pdf as belegPdf,
    show as belegShow,
} from '@/routes/belege';
import type { BelegSortKey, BelegePageProps, SortDirection } from '@/types';

type BelegeQuery = {
    year: string;
    search?: string;
    exact_amount?: string;
    sort: BelegSortKey;
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

export default function Belege({
    availableYears,
    selectedYear,
    filters,
    summary,
    belege,
}: BelegePageProps) {
    const baseQuery = (): BelegeQuery => ({
        year: filters.year,
        search: filters.search || undefined,
        exact_amount: filters.exact_amount || undefined,
        sort: filters.sort,
        dir: filters.dir,
        page: belege.current_page,
    });

    const visitWithQuery = (nextQuery: Partial<BelegeQuery>) => {
        router.visit(
            belegeIndex({
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

    const changeSort = (sort: BelegSortKey) => {
        const nextDirection: SortDirection =
            filters.sort === sort && filters.dir === 'asc' ? 'desc' : 'asc';

        visitWithQuery({
            sort,
            dir: nextDirection,
            page: 1,
        });
    };

    const openBeleg = (belegId: number) => {
        router.visit(
            belegShow(belegId, {
                query: baseQuery(),
            }),
        );
    };

    const handleBelegKeyDown = (
        event: KeyboardEvent<HTMLTableRowElement>,
        belegId: number,
    ) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();

        openBeleg(belegId);
    };

    return (
        <>
            <Head title="Belege" />

            <AppShell>
                <div className="space-y-6 pb-10">
                    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                        <Card className="overflow-hidden rounded-[2rem] border-white/80 bg-white/90 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
                            <CardContent className="space-y-8 px-6 py-7 sm:px-8 sm:py-8">
                                <div className="space-y-5">
                                    <Badge className="w-fit rounded-full bg-slate-900 text-white hover:bg-slate-900">
                                        Belege
                                    </Badge>
                                    <div className="space-y-3">
                                        <h1
                                            className="text-4xl font-semibold tracking-tight text-balance text-slate-950 sm:text-5xl"
                                            style={{
                                                fontFamily:
                                                    'var(--font-display)',
                                            }}
                                        >
                                            Dokumente und PDFs für{' '}
                                            {formatYearLabel(selectedYear)}.
                                        </h1>
                                        <p className="max-w-3xl text-lg leading-8 text-slate-600">
                                            Die Belegansicht priorisiert
                                            Vollständigkeit: Lieferant,
                                            Rechnungsnummer, Betrag, direkter
                                            PDF-Zugriff und die Zuordnung zu
                                            passenden Transaktionen.
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
                                        <SelectTrigger className="h-11 w-full rounded-2xl">
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
                                        <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-slate-400" />
                                        <Input
                                            className="h-11 rounded-2xl pl-11"
                                            defaultValue={filters.search}
                                            name="search"
                                            placeholder="Lieferant, Rechnungsnummer oder Datei durchsuchen"
                                        />
                                    </div>

                                    <Input
                                        className="h-11 rounded-2xl text-right tabular-nums"
                                        defaultValue={filters.exact_amount}
                                        inputMode="decimal"
                                        name="exact_amount"
                                        placeholder="Exakter Betrag"
                                    />

                                    <Button
                                        className="h-11 rounded-2xl px-5"
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
                                        Belege
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
                                        Bruttosumme
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-semibold text-slate-950">
                                        {formatCurrency(
                                            summary.gross_total_cents,
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="rounded-[1.8rem] border-white/80 bg-white/90">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-xs tracking-[0.24em] text-slate-500 uppercase">
                                        PDF-Deckung
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <div className="text-2xl font-semibold text-emerald-700">
                                        {formatCount(summary.with_pdf_count)}
                                    </div>
                                    <p className="text-xs tracking-[0.18em] text-slate-500 uppercase">
                                        {formatCount(
                                            summary.missing_supplier_count,
                                        )}{' '}
                                        ohne Lieferant
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
                                Belegliste
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
                                                    changeSort('document_date')
                                                }
                                                type="button"
                                            >
                                                Datum
                                                <ArrowUpDownIcon className="size-4" />
                                                <span className="sr-only">
                                                    {sortLabel(
                                                        filters.sort ===
                                                            'document_date',
                                                        filters.dir,
                                                    )}
                                                </span>
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button
                                                className="inline-flex items-center gap-2 font-semibold"
                                                onClick={() =>
                                                    changeSort('issuer_name')
                                                }
                                                type="button"
                                            >
                                                Lieferant
                                                <ArrowUpDownIcon className="size-4" />
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button
                                                className="inline-flex items-center gap-2 font-semibold"
                                                onClick={() =>
                                                    changeSort('invoice_number')
                                                }
                                                type="button"
                                            >
                                                Rechnung
                                                <ArrowUpDownIcon className="size-4" />
                                            </button>
                                        </TableHead>
                                        <TableHead>Betreff</TableHead>
                                        <TableHead className="text-right">
                                            <button
                                                className="inline-flex items-center gap-2 font-semibold"
                                                onClick={() =>
                                                    changeSort(
                                                        'gross_amount_cents',
                                                    )
                                                }
                                                type="button"
                                            >
                                                Betrag
                                                <ArrowUpDownIcon className="size-4" />
                                            </button>
                                        </TableHead>
                                        <TableHead className="text-right">
                                            PDF
                                        </TableHead>
                                        <TableHead className="text-right">
                                            Zuordnung
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {belege.data.map((beleg) => (
                                        <TableRow
                                            className="cursor-pointer transition-colors hover:bg-slate-50/80 focus-visible:bg-slate-50/80"
                                            key={beleg.id}
                                            onClick={() => openBeleg(beleg.id)}
                                            onKeyDown={(event) =>
                                                handleBelegKeyDown(
                                                    event,
                                                    beleg.id,
                                                )
                                            }
                                            tabIndex={0}
                                        >
                                            <TableCell className="px-6 py-4 font-medium text-slate-700">
                                                {formatDate(
                                                    beleg.document_date,
                                                )}
                                            </TableCell>
                                            <TableCell className="py-4">
                                                <div className="space-y-1">
                                                    <div className="font-semibold text-slate-950">
                                                        {beleg.issuer_name ??
                                                            'Unbekannt'}
                                                    </div>
                                                    <div className="text-xs text-slate-500">
                                                        {beleg.source_year}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-4 text-slate-600">
                                                {beleg.invoice_number ?? '–'}
                                            </TableCell>
                                            <TableCell className="py-4">
                                                <div className="max-w-md space-y-1">
                                                    <div className="truncate font-medium text-slate-950">
                                                        {beleg.subject ??
                                                            beleg.summary_short ??
                                                            beleg.target_basename}
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                                        {beleg.document_type && (
                                                            <Badge
                                                                className="rounded-full"
                                                                variant="secondary"
                                                            >
                                                                {
                                                                    beleg.document_type
                                                                }
                                                            </Badge>
                                                        )}
                                                        <span>
                                                            {
                                                                beleg.target_basename
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-4 text-right font-semibold text-slate-950 tabular-nums">
                                                {formatCurrency(
                                                    beleg.gross_amount_cents,
                                                )}
                                            </TableCell>
                                            <TableCell className="py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
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
                                                            ? 'vorhanden'
                                                            : 'fehlt'}
                                                    </Badge>
                                                    {beleg.pdf_available && (
                                                        <Button
                                                            asChild
                                                            className="rounded-full"
                                                            size="sm"
                                                            variant="outline"
                                                        >
                                                            <a
                                                                href={belegPdf.url(
                                                                    {
                                                                        importedBeleg:
                                                                            beleg.id,
                                                                    },
                                                                )}
                                                                onClick={(
                                                                    event,
                                                                ) =>
                                                                    event.stopPropagation()
                                                                }
                                                                rel="noreferrer"
                                                                target="_blank"
                                                            >
                                                                PDF
                                                                <ExternalLinkIcon />
                                                            </a>
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-4 text-right">
                                                <div className="flex flex-col items-end gap-1">
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
                                                    <span className="text-xs text-slate-500">
                                                        {
                                                            beleg.transactions_count
                                                        }{' '}
                                                        {beleg.transactions_count ===
                                                        1
                                                            ? 'Transaktion'
                                                            : 'Transaktionen'}
                                                    </span>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>

                            <TablePagination
                                currentPage={belege.current_page}
                                from={belege.from}
                                lastPage={belege.last_page}
                                onPageChange={(page) =>
                                    visitWithQuery({ page })
                                }
                                to={belege.to}
                                total={belege.total}
                            />
                        </CardContent>
                    </Card>
                </div>
            </AppShell>
        </>
    );
}
