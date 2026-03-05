import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type DocumentPreviewPaneProps = {
  title: string;
  url: string | null;
  mimeType: string | null;
  fileName: string | null;
  fallbackText?: string;
};

function isPdfPreview(url: string | null, mimeType: string | null): boolean {
  const mime = mimeType?.toLowerCase() ?? "";
  const safeUrl = url ?? "";
  if (mime.includes("pdf")) {
    return true;
  }
  return /\.pdf($|\?)/i.test(safeUrl);
}

function isImagePreview(url: string | null, mimeType: string | null): boolean {
  const mime = mimeType?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) {
    return true;
  }
  const safeUrl = url ?? "";
  return /\.(jpe?g|png|webp|gif|bmp|tiff?|avif)(\?|$)/i.test(safeUrl);
}

export function DocumentPreviewPane({ title, url, mimeType, fileName, fallbackText = "Vorschau nicht verfügbar." }: DocumentPreviewPaneProps) {
  const file = fileName?.trim() || "Dokument";
  const hasUrl = Boolean(url);

  if (!hasUrl) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{fallbackText}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{file}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPdfPreview(url, mimeType) ? (
          <iframe src={url} title={title} className="h-[70vh] w-full rounded-md border" />
        ) : isImagePreview(url, mimeType) ? (
          <img src={url} alt={file} className="h-auto max-h-[70vh] w-full rounded-md border object-contain" />
        ) : (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <p className="text-sm text-muted-foreground">{fallbackText}</p>
            <Button asChild variant="outline" size="sm">
              <a href={url} target="_blank" rel="noreferrer">
                Dokument öffnen
              </a>
            </Button>
          </div>
        )}
        <div className="text-xs">
          {isPdfPreview(url, mimeType) || isImagePreview(url, mimeType) ? (
            <Button asChild variant="outline" size="sm">
              <a href={url} target="_blank" rel="noreferrer">
                In neuem Tab öffnen
              </a>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
