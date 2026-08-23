import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** Render TSX to inert HTML. The browser receives no React runtime or hydration. */
export const render2Mkup = (node: ReactNode): string => renderToStaticMarkup(<>{node}</>);
