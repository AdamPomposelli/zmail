import { AccountWizard } from './onboarding/account-wizard';

/** First launch: no mailbox yet. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  return <AccountWizard variant="page" onDone={onDone} />;
}
