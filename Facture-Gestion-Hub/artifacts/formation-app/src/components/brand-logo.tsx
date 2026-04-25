import { cn } from "@/lib/utils";
import logoSrc from "@/assets/logo.jpg";

type BrandLogoProps = {
  className?: string;
};

/**
 * Logo officiel (fichier source à la racine du dépôt : `Facture-Gestion-Hub/logo.jpg`).
 * Import Vite = URL fiable en dev Docker et en build (pas seulement `/public`).
 */
export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <img
      src={logoSrc}
      alt="Auto-entrepreneur — المقاول الذاتي"
      className={cn(
        "h-auto w-auto shrink-0 object-contain object-left",
        className,
      )}
      decoding="async"
    />
  );
}
