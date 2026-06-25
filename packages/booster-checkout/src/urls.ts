/**
 * SteamBalance booster business URLs, owned and hardcoded by the checkout
 * plugin (allowed here per the URLs convention; plugins own their own URL
 * constants). The retired manifest v1 `urls` block no longer carries these.
 *
 * Changing a URL requires a new plugin release and a sha256 bump in the
 * manifest. If you fork this plugin for a different backend, change these.
 */
export const URLS = {
  paymentMethodsApi:  'https://steambalance.cc/api/payments',
  balanceCalcApi:     'https://steambalance.cc/api/balance/calc',
  balanceAddApi:      'https://steambalance.cc/api/balance/add',
  orders:             'https://steambalance.cc/booster/orders',
  faq:                'https://steambalance.cc/booster/faq',
  terms:              'https://steambalance.cc/booster/terms',
  privacy:            'https://steambalance.cc/booster/privacy',
  telegram:           'https://steambalance.cc/c/0eb9',
  paymentImagesBase:  'https://steambalance.cc/assets/images/payments',
  // Logo click-through link (brand site home). NOT the image source —
  // the popup renders the logo from a build-time data-URI (IMG_LOGO_DATA_URI).
  popupLogoLink:      'https://steambalance.cc',
  support:            'https://jivo.chat/OdRu6JcBYZ',
  about:              'https://steambalance.cc',
  steamKeysApi:       'https://steambalance.cc/api/services/steam_keys',
} as const;
