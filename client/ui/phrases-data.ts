// All translation tables in one chunk, downloaded only when a language other than English is chosen.
import { P1 } from './phrases-1.ts';
import { P2 } from './phrases-2.ts';
import { P3 } from './phrases-3.ts';
import { P4 } from './phrases-4.ts';
import { P5 } from './phrases-5.ts';
export const PHRASES = { ...P1, ...P2, ...P3, ...P4, ...P5 };
