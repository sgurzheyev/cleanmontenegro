/**
 * Client-side "Review & Release" / "Approve & Release Payment" CTAs (Profile, review modal).
 * Single source of truth: base interaction classes must not be dropped when adding loading/disabled.
 */
export const CLIENT_APPROVE_RELEASE_BTN_CORE =
  'rounded-full bg-emerald-500 text-black font-black uppercase tracking-[0.2em] ' +
  'shadow-md hover:shadow-lg hover:bg-emerald-400 ' +
  'transition-all duration-200 transition-transform active:scale-95 ' +
  'disabled:opacity-70 disabled:cursor-not-allowed';

/** Full-width list / card rows (My missions, etc.) */
export const CLIENT_APPROVE_RELEASE_BTN_LIST = `${CLIENT_APPROVE_RELEASE_BTN_CORE} w-full py-3 text-xs`;

/** Modal primary action (side-by-side with dispute on sm+) */
export const CLIENT_APPROVE_RELEASE_BTN_MODAL = `${CLIENT_APPROVE_RELEASE_BTN_CORE} flex-1 w-full min-h-[48px] py-3 px-4 text-sm inline-flex items-center justify-center gap-2`;

/** Paired "Open Dispute" in review modal — same motion/shadow system, different colors */
export const CLIENT_OPEN_DISPUTE_BTN_MODAL =
  'flex-1 w-full min-h-[48px] py-3 px-4 rounded-full bg-red-500/20 border border-red-500/60 text-red-300 ' +
  'font-black text-sm uppercase tracking-[0.2em] ' +
  'shadow-md hover:shadow-lg hover:bg-red-500/30 hover:text-red-200 ' +
  'transition-all duration-200 transition-transform active:scale-95 ' +
  'disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2';

/** Admin "Force Release Payment" — compact inline, same tactile/shadow/loading tokens */
export const ADMIN_FORCE_RELEASE_PAYMENT_BTN =
  'shrink-0 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider ' +
  'bg-red-500/20 border border-red-400/60 text-red-300 hover:bg-red-500/30 hover:border-red-400 ' +
  'shadow-md hover:shadow-lg ' +
  'transition-all duration-200 active:scale-95 ' +
  'disabled:opacity-70 disabled:cursor-not-allowed ' +
  'inline-flex items-center justify-center gap-1.5';

/** Profile / Telegram WebView — glass panels (single source of truth) */
export const PROFILE_GLASS_PANEL =
  'backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl';

/**
 * All wallet balances, mission prices, bids, donations, scout rewards, and RPC amounts
 * are stored and displayed in this currency unless explicitly noted (e.g. Stripe card auth in USD).
 */
export const INTERNAL_CURRENCY = 'EUR' as const;

/**
 * City pin / Scout Stake fee (EUR, integer) — must match DB mission fee and wallet debits.
 *
 * NOTE: Kept old constant name for compatibility during refactor.
 */
export const SCOUT_STAKE_FEE_EGP = 5;

/** Anti-fraud: repeated micro-tx at or below this EUR amount (wallet is EUR). */
export const SMALL_CARDING_EGP_MAX = 10;

/** Display suffix for amounts in UI (Euro). */
export const DISPLAY_CURRENCY_SUFFIX = 'EUR';

/** Min/max mission prices in EUR. */
export const HOME_MIN_PRICE = 25;
export const HOME_MAX_PRICE = 2500;
/** Minimum crowdfunding goal for city missions (EUR), separate from {@link SCOUT_STAKE_FEE_EGP}. */
export const CITY_MIN_PRICE = 5;
export const CITY_MAX_PRICE = 500;

export const MIN_SIZE = 10;
export const MAX_SIZE = 10000;

export const MAX_PHOTOS = 10;

export const translations: Record<string, Record<string, string>> = {
  en: {
    'app_title': 'CleanMontenegro',
    'lang_switcher': 'عربي',
    'clean_my_home': 'Clean My Home',
    'clean_my_city': 'Clean My City',
    'order_form_title_home': 'Schedule Your Home Cleaning',
    'order_form_title_city': 'Support a City Cleanup',
    'photo_upload_title': 'Upload Photos (Up to 10)',
    'photo_upload_subtitle': 'Show us the area to be cleaned!',
    'photo_upload_cta': 'Click or drag to upload',
    'size_slider_title': 'Area Size',
    'sqm': 'sq.m.',
    'price_slider_title_home': 'Your Offer',
    'price_slider_title_city': 'Your Donation',
    'comment_title': 'Extra Details',
    'comment_placeholder': 'e.g., focus on the kitchen, hard-to-reach spots...',
    'comment_placeholder_city': 'e.g., near the beach, a specific street corner...',
    'submit_order': 'Place Order & Proceed to Pay',
    'anti_cheat_title': 'Fair Play System',
    'anti_cheat_desc': 'We use GPS verification and AI-powered "Before/After" photo analysis to ensure all jobs are completed perfectly.',
  },
  ar: {
    'app_title': 'كلين إيجيبت',
    'lang_switcher': 'English',
    'clean_my_home': 'نظف بيتي',
    'clean_my_city': 'نظف مدينتي',
    'order_form_title_home': 'احجز خدمة تنظيف منزلك',
    'order_form_title_city': 'ادعم تنظيف المدينة',
    'photo_upload_title': 'حمل الصور (حتى ١٠)',
    'photo_upload_subtitle': 'أرنا المنطقة التي تحتاج إلى تنظيف!',
    'photo_upload_cta': 'اضغط أو اسحب للتحميل',
    'size_slider_title': 'المساحة',
    'sqm': 'متر مربع',
    'price_slider_title_home': 'عرضك',
    'price_slider_title_city': 'تبرعك',
    'comment_title': 'تفاصيل إضافية',
    'comment_placeholder': 'مثال: التركيز على المطبخ، أماكن صعبة الوصول...',
    'comment_placeholder_city': 'مثال: بالقرب من النيل، زاوية شارع معينة...',
    'submit_order': 'قدم الطلب وانتقل للدفع',
    'anti_cheat_title': 'نظام اللعب النظيف',
    'anti_cheat_desc': 'نستخدم التحقق من الموقع (GPS) وتحليل الصور بالذكاء الاصطناعي "قبل/بعد" لضمان إتمام جميع المهام على أكمل وجه.',
  },
};
