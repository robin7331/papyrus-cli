const moneyFormatter = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
});

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
});

const dateTimeFormatter = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
});

const compactNumberFormatter = new Intl.NumberFormat('de-DE');

export function formatCurrency(value: number | null): string {
    if (value === null) {
        return '-';
    }

    return moneyFormatter.format(value / 100);
}

export function formatDate(value: string | null): string {
    if (value === null) {
        return '-';
    }

    return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: string | null): string {
    if (value === null) {
        return '-';
    }

    return dateTimeFormatter.format(new Date(value));
}

export function formatCount(value: number): string {
    return compactNumberFormatter.format(value);
}

export function formatYearLabel(year: string): string {
    return year === 'all' ? 'Alle Jahre' : year;
}
