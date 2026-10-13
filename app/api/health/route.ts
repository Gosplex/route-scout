import { hasOpenRouter } from '@/lib/openrouter';
import { hasQloo } from '@/lib/qloo';
import { hasTicketmaster } from '@/lib/ticketmaster';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ qloo: hasQloo(), ticketmaster: hasTicketmaster(), ai: hasOpenRouter() });
}
