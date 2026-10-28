import { redirect } from 'react-router';

export const clientLoader = () => redirect('/settings/accounts');

export default function SettingsIndex() {
  return null;
}
