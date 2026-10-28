import { redirect } from 'react-router';

export const clientLoader = () => redirect('/mail/inbox');

export default function Index() {
  return null;
}
