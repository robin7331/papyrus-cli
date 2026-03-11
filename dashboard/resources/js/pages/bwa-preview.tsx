import { Head, Link } from '@inertiajs/react';
import { PrinterIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/bookkeeping';
import { cn } from '@/lib/utils';
import { index as bwaIndex } from '@/routes/bwa';
import type { BwaEstimatePageProps, BwaEstimateProfitStatus } from '@/types';

type PreviewRow = {
    amount_cents: number;
    indent?: boolean;
    label: string;
    muted?: boolean;
};

function profitTone(status: BwaEstimateProfitStatus): string {
    if (status === 'profit') {
        return 'text-emerald-700';
    }

    if (status === 'loss') {
        return 'text-rose-700';
    }

    return 'text-slate-700';
}

function formatDateLabel(): string {
    return new Intl.DateTimeFormat('de-DE').format(new Date());
}

function periodLabel(year: number | null): string {
    if (year === null) {
        return '-';
    }

    return `Januar bis Dezember ${year}`;
}

export default function BwaPreview({
    selectedYear,
    summary,
}: BwaEstimatePageProps) {
    const createdAt = formatDateLabel();

    const rows: PreviewRow[] =
        summary === null
            ? []
            : [
                  {
                      amount_cents: summary.operating_inflow_gross_cents,
                      label: 'Betriebliche Einzahlungseingänge (brutto)',
                  },
                  {
                      amount_cents: -summary.assumed_output_vat_cents,
                      indent: true,
                      label: '- Umsatzsteuer 19%',
                      muted: true,
                  },
                  {
                      amount_cents: summary.assumed_revenue_net_cents,
                      label: 'Netto-Umsatzerlöse',
                  },
                  {
                      amount_cents: summary.operating_outflow_gross_cents,
                      label: 'Betriebliche Ausgänge (brutto)',
                  },
                  {
                      amount_cents: -summary.assumed_input_vat_cents,
                      indent: true,
                      label: '- Vorsteuer',
                      muted: true,
                  },
                  {
                      amount_cents: summary.assumed_expense_net_cents,
                      label: 'Netto-Ausgänge / Aufwand',
                  },
                  {
                      amount_cents: summary.separate_tax_movement_cents,
                      label: 'Steuerzahlungen separat',
                  },
                  {
                      amount_cents: summary.excluded_net_movement_cents,
                      label: 'Privat / Finanzierung ausgeschlossen',
                  },
                  {
                      amount_cents: summary.estimated_operating_profit_cents,
                      label: 'Betriebsergebnis',
                  },
                  {
                      amount_cents: summary.estimated_net_vat_payable_cents,
                      label: 'Netto-USt / Erstattung',
                  },
              ];

    return (
        <>
            <Head title="" />

            <div className="min-h-screen bg-[#efefef] px-2 py-2 text-[#424650] print:bg-white print:p-0">
                <div className="mx-auto max-w-[210mm]">
                    <div className="mb-2 flex items-center justify-between px-1 print:hidden">
                        <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">
                            BWA DIN A4
                        </p>
                        <div className="flex items-center gap-2">
                            <Button asChild size="sm" variant="outline">
                                <Link
                                    href={bwaIndex.url({
                                        query: selectedYear
                                            ? { year: selectedYear }
                                            : undefined,
                                    })}
                                >
                                    Zurück
                                </Link>
                            </Button>
                            <Button onClick={() => window.print()} size="sm" type="button">
                                <PrinterIcon />
                                Drucken
                            </Button>
                        </div>
                    </div>

                    <main className="min-h-[297mm] w-[210mm] bg-[#f9f9fa] px-[14mm] py-[12mm] shadow-[0_1px_4px_rgba(0,0,0,0.08)] print:min-h-0 print:w-full print:bg-white print:shadow-none">
                        <header className="border-b border-[#d8d9dd] pb-6">
                            <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
                                <div className="space-y-1 pt-8">
                                    <h1
                                        className="text-[18px] font-semibold text-[#2f3440]"
                                        style={{
                                            fontFamily: 'var(--font-display)',
                                        }}
                                    >
                                        BitMechanics GmbH
                                    </h1>
                                    <p className="text-[11px] font-medium text-[#6f7480]">
                                        Zeitraum: {periodLabel(selectedYear)}
                                    </p>
                                    <p className="text-[11px] text-[#8b9099]">
                                        Basis: SKR 03 · Ist-Versteuerung (falls
                                        zutreffend)
                                    </p>
                                </div>

                                <div className="pt-8 text-center">
                                    <h2
                                        className="text-[18px] font-semibold text-[#313640]"
                                        style={{
                                            fontFamily: 'var(--font-display)',
                                        }}
                                    >
                                        Betriebswirtschaftliche Auswertung
                                        (BWA)
                                    </h2>
                                </div>

                                <div className="space-y-1 pt-9 text-right text-[11px] text-[#7e838d]">
                                    <p>Erstellt am: {createdAt}</p>
                                    <p>Seite 1/1</p>
                                </div>
                            </div>
                        </header>

                        {summary === null ? (
                            <section className="py-16 text-center text-sm text-slate-600">
                                Keine Jahresdaten mit importierten
                                Transaktionen vorhanden.
                            </section>
                        ) : (
                            <>
                                <section className="mt-8 grid grid-cols-3 gap-4">
                                    <div className="rounded-[10px] border border-[#dcdee2] bg-[#f2f3f5] px-4 py-3">
                                        <p className="text-[11px] font-semibold text-[#8a8f98]">
                                            Netto-Umsatzerlöse
                                        </p>
                                        <p className="mt-2 text-[22px] font-semibold text-[#2f3440]">
                                            {formatCurrency(
                                                summary.assumed_revenue_net_cents,
                                            )}
                                        </p>
                                    </div>
                                    <div className="rounded-[10px] border border-[#dcdee2] bg-[#f2f3f5] px-4 py-3">
                                        <p className="text-[11px] font-semibold text-[#8a8f98]">
                                            Betriebsergebnis
                                        </p>
                                        <p
                                            className={cn(
                                                'mt-2 text-[22px] font-semibold',
                                                profitTone(
                                                    summary.profit_status,
                                                ),
                                            )}
                                        >
                                            {formatCurrency(
                                                summary.estimated_operating_profit_cents,
                                            )}
                                        </p>
                                    </div>
                                    <div className="rounded-[10px] border border-[#dcdee2] bg-[#f2f3f5] px-4 py-3">
                                        <p className="text-[11px] font-semibold text-[#8a8f98]">
                                            Netto-USt / Erstattung
                                        </p>
                                        <p
                                            className={cn(
                                                'mt-2 text-[22px] font-semibold',
                                                summary.estimated_net_vat_payable_cents <=
                                                    0
                                                    ? 'text-emerald-700'
                                                    : 'text-amber-700',
                                            )}
                                        >
                                            {formatCurrency(
                                                summary.estimated_net_vat_payable_cents,
                                            )}
                                        </p>
                                    </div>
                                </section>

                                <section className="mt-8">
                                    <div className="space-y-1">
                                        <h3 className="text-[15px] font-semibold text-[#39404a]">
                                            Erfolgsrechnung (Kurz-BWA)
                                        </h3>
                                        <p className="text-[11px] text-[#8a8f98]">
                                            Darstellung auf Basis der
                                            vorliegenden Kontoauszüge · Werte in
                                            EUR
                                        </p>
                                    </div>

                                    <div className="mt-3 rounded-[12px] border border-[#dcdee2] bg-[#fbfbfc] px-4 py-4">
                                        <div className="font-mono text-[11px] leading-5 text-[#545a63]">
                                            <div className="grid grid-cols-[1fr_94px] gap-4 border-b border-dashed border-[#aeb3bc] pb-1 font-semibold uppercase tracking-[0.06em] text-[#767c87]">
                                                <div>Position</div>
                                                <div className="text-right">
                                                    Betrag
                                                </div>
                                            </div>

                                            <div className="space-y-0.5 pt-2">
                                                {rows.map((row, index) => {
                                                    const showSeparator = [
                                                        'Betriebliche Ausgänge (brutto)',
                                                        'Steuerzahlungen separat',
                                                        'Betriebsergebnis',
                                                    ].includes(row.label);

                                                    return (
                                                        <div
                                                            className="contents"
                                                            key={`${row.label}-${index}`}
                                                        >
                                                            {showSeparator && (
                                                                <div className="col-span-2 my-0.5 border-t border-dashed border-[#aeb3bc]" />
                                                            )}
                                                            <div className="grid grid-cols-[1fr_94px] gap-4">
                                                                <div
                                                                    className={cn(
                                                                        row.indent &&
                                                                            'pl-3',
                                                                        row.muted &&
                                                                            'text-[#7f848d]',
                                                                        row.label ===
                                                                            'Jahresüberschuss / -fehlbetrag' &&
                                                                            'font-semibold',
                                                                    )}
                                                                >
                                                                    {row.label}
                                                                </div>
                                                                <div className="text-right font-semibold text-[#3f444d]">
                                                                    {formatCurrency(
                                                                        row.amount_cents,
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                    </div>
                                </section>

                                <footer className="mt-16 flex items-end justify-between text-[10px] text-[#8f949c]">
                                    <div className="space-y-1">
                                        <p>
                                            Interne Auswertung · Nicht
                                            Bestandteil des Jahresabschlusses
                                        </p>
                                        <p>
                                            Diese BWA wurde unter Vorbehalt
                                            erstellt.
                                        </p>
                                    </div>
                                    <div className="space-y-1 text-right font-semibold text-[#767b84]">
                                        <p>BitMechanics GmbH</p>
                                        <p>BWA · Stand: {createdAt}</p>
                                    </div>
                                </footer>
                            </>
                        )}
                    </main>
                </div>
            </div>
        </>
    );
}
