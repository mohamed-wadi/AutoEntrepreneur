import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type FilePreviewPayload = {
  blobUrl: string;
  fileName: string;
  mime: string;
};

type Props = {
  payload: FilePreviewPayload;
  onOpenChange: (open: boolean) => void;
};

export function FilePreviewDialog({ payload, onOpenChange }: Props) {
  const { blobUrl, fileName, mime } = payload;
  const isPdf = /pdf/i.test(mime) || /\.pdf$/i.test(fileName);
  const isImage =
    /^image\//i.test(mime) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(96vw,1100px)] max-w-[min(96vw,1100px)] flex-col gap-2 p-4 sm:p-6">
        <DialogHeader className="shrink-0 space-y-1 pr-8">
          <DialogTitle className="truncate text-left" title={fileName}>
            Aperçu — {fileName}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
          {isPdf ? (
            <iframe title={fileName} src={blobUrl} className="h-[min(78vh,760px)] w-full border-0 bg-white" />
          ) : isImage ? (
            <div className="flex max-h-[min(78vh,760px)] items-center justify-center overflow-auto p-2">
              <img src={blobUrl} alt="" className="max-h-full max-w-full object-contain" />
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center px-4 text-center text-sm text-slate-600">
              Aperçu intégré non disponible pour ce type de fichier. Utilisez le bouton Télécharger.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
