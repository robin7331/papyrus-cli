import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type TablePaginationProps = {
    currentPage: number;
    lastPage: number;
    from: number | null;
    to: number | null;
    total: number;
    onPageChange: (page: number) => void;
};

function visiblePages(currentPage: number, lastPage: number): number[] {
    const firstPage = Math.max(1, currentPage - 2);
    const finalPage = Math.min(lastPage, firstPage + 4);
    const adjustedFirstPage = Math.max(1, finalPage - 4);

    return Array.from(
        { length: finalPage - adjustedFirstPage + 1 },
        (_, index) => adjustedFirstPage + index,
    );
}

export function TablePagination({
    currentPage,
    lastPage,
    from,
    to,
    total,
    onPageChange,
}: TablePaginationProps) {
    if (total === 0) {
        return (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
                <span>Keine Eintraege vorhanden.</span>
            </div>
        );
    }

    const pages = visiblePages(currentPage, lastPage);

    return (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <span>
                Zeige {from ?? 0} bis {to ?? 0} von {total}
            </span>
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    disabled={currentPage <= 1}
                    onClick={() => onPageChange(currentPage - 1)}
                    size="sm"
                    type="button"
                    variant="outline"
                >
                    Zurueck
                </Button>
                {pages.map((page) => (
                    <Button
                        className={cn(
                            'min-w-9 rounded-full',
                            page === currentPage && 'shadow-sm',
                        )}
                        key={page}
                        onClick={() => onPageChange(page)}
                        size="sm"
                        type="button"
                        variant={page === currentPage ? 'default' : 'outline'}
                    >
                        {page}
                    </Button>
                ))}
                <Button
                    disabled={currentPage >= lastPage}
                    onClick={() => onPageChange(currentPage + 1)}
                    size="sm"
                    type="button"
                    variant="outline"
                >
                    Weiter
                </Button>
            </div>
        </div>
    );
}
