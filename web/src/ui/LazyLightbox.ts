import { lazy } from "react";

/** The lightbox chunk loads on the first thumbnail open (or hover / focus); wrap in <Suspense>. */
export const LazyLightbox = lazy(() => import("./Lightbox"));

export const preloadLightbox = (): void => void import("./Lightbox");
