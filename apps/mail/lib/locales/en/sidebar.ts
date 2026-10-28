// English translations, keyed by the French text (see lib/i18n.ts).
export default {
  // sidebar/mail-nav.tsx, sidebar/nav.tsx — the row menus, rename in place
  'Renommer': 'Rename',
  'Nouveau nom': 'New name',
  'Icône et couleur…': 'Icon and colour…',
  'Modifier la catégorie…': 'Edit category…',
  'Changer l’icône': 'Change icon',
  'Changer l’icône…': 'Change icon…',
  'Changer l’icône de {name}': 'Change the icon of {name}',
  'Icône d’origine': 'Original icon',
  'Nom et icône d’origine': 'Original name and icon',
  'Déposez ici pour ranger': 'Drop here to file it',
  'Supprimer la catégorie « {name} » ? L’IA ne l’utilisera plus. Vous pourrez la rétablir dans Réglages → Catégories.':
    'Delete the “{name}” category? The AI will stop using it. You can bring it back in Settings → Categories.',
  'Supprimer la catégorie « {name} » ? Les mails restent, ils perdent seulement cette catégorie.': 'Delete the “{name}” category? Your emails stay; they only lose this category.',
  'Catégorie « {name} » supprimée': '“{name}” category deleted',
  'Ajouter un compte': 'Add an account',
  'Réglages du compte': 'Account settings',
  'Modifier la connexion…': 'Edit connection…',
  'Afficher l’adresse': 'Show the address',
  'Synchronisation relancée': 'Sync restarted',

  // category-dialog.tsx
  'Catégorie enregistrée': 'Category saved',
  'Nom, description, icône et couleur': 'Name, description, icon and colour',
  'De quoi parlent ces mails ?': 'What are these emails about?',
  'Ex. : factures et relances de nos fournisseurs': 'E.g. invoices and reminders from our suppliers',
  'L’IA s’en sert pour ranger les mails dans cette catégorie.': 'The AI uses it to file emails in this category.',

  // settings/tags.tsx
  'Supprimer la catégorie « {name} » ? L’IA ne l’utilisera plus. Vous pourrez la rétablir plus bas.': 'Delete the “{name}” category? The AI will stop using it. You can bring it back below.',
  'Catégories supprimées': 'Deleted categories',
  'Catégories génériques que vous avez retirées : l’IA ne les utilise plus.': 'Built-in categories you removed: the AI no longer uses them.',
  'Catégorie « {name} » rétablie': '“{name}” category restored',
  'Rétablir': 'Restore',
  'Fournies par ZMail et utilisées par le tri automatique. Vous pouvez les renommer, les modifier ou les supprimer.': 'Provided by ZMail and used by automatic sorting. You can rename, edit or delete them.',

  // settings/accounts.tsx, settings/account-edit-dialog.tsx
  'Modifier le nom et la connexion': 'Edit name and connection',
  'Compte enregistré, reconnexion en cours': 'Account saved, reconnecting',
  'Compte enregistré': 'Account saved',
  'Port': 'Port',
  'Nom du compte, nom d’expéditeur et connexion': 'Account name, sender name and connection',
  'Nom dans ZMail': 'Name in ZMail',
  'Ex. : « Pro », « Perso ». Vide : l’adresse s’affiche.': 'E.g. “Work”, “Personal”. Empty: the address is shown.',
  'Ce que voient vos destinataires.': 'What your recipients see.',
  'Pour corriger des réglages erronés ou un mot de passe changé. La nouvelle connexion est testée avant d’être enregistrée.':
    'To fix wrong settings or a changed password. The new connection is tested before it is saved.',
  'Identifiant': 'Username',
  'Inchangé': 'Unchanged',
  'Envoi': 'Sending',
  'connexion réussie': 'connected',
  'Tester la connexion': 'Test connection',
  'La connexion échoue : corrigez avant d’enregistrer.': 'The connection fails: fix it before saving.',
  'Tester et enregistrer': 'Test and save',
} as Record<string, string>;
