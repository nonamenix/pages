const siteTitle = 'pages.live4.dev';

export default {
  config: {
    locales: ['ru'],
    translations: {
      en: {
        'Auth.form.welcome.title': siteTitle,
        'Auth.form.welcome.subtitle': `Sign in to manage ${siteTitle}`,
        'HomePage.head.title': siteTitle,
        'HomePage.header.subtitle': `Administration panel for ${siteTitle}`,
        'app.components.LeftMenu.navbrand.title': siteTitle,
        'app.components.LeftMenu.navbrand.workplace': 'Administration panel',
      },
      ru: {
        'Auth.form.welcome.title': siteTitle,
        'Auth.form.welcome.subtitle': `Войдите, чтобы управлять сайтом ${siteTitle}`,
        'HomePage.head.title': siteTitle,
        'HomePage.header.subtitle': `Панель управления сайтом ${siteTitle}`,
        'app.components.LeftMenu.navbrand.title': siteTitle,
        'app.components.LeftMenu.navbrand.workplace': 'Панель управления',
      },
    },
  },
};
