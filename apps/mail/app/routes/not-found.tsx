import { Link } from 'react-router';
import { t } from '@/lib/i18n';

export default function NotFound() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-2">
      <p className="text-muted-foreground/30 text-7xl font-semibold">404</p>
      <Link to="/mail/inbox" className="text-sm underline underline-offset-4">
        {t('Retour à la boîte de réception')}
      </Link>
    </div>
  );
}
