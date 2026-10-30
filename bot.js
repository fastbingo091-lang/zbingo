let TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || 'http://localhost:5000';
const SERVER_API_URL = process.env.SERVER_API_URL || WEBAPP_URL;
const BOT_SERVER_API_KEY = process.env.BOT_SERVER_API_KEY || process.env.PAYMENT_SMS_API_KEY || 'change-me-payment-sms-key';
const BOT_WELCOME_PHOTO_URL = process.env.BOT_WELCOME_PHOTO_URL || (isHttpsUrl(WEBAPP_URL) ? `${WEBAPP_URL.replace(/\/$/, '')}/assets/bot-welcome-habesha-bingo.png` : '');
const { canonicalEthiopianPhone } = require('./lib/phone');

let offset = 0;
let lastConfigCheck = 0;
let BOT_USERNAME = String(process.env.TELEGRAM_BOT_USERNAME || 'zbingo111_bot').replace(/^@/, '').trim();
let BOT_READY = false;
const chatFlows = new Map();
const chatLanguages = new Map();
const chatReferrals = new Map();

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isHttpsUrl(url) {
  return /^https:\/\//i.test(String(url || ''));
}

function withWebAppParam(url, key, value = '1') {
  const clean = String(url || '').trim();
  if (!clean) return clean;
  const separator = clean.includes('?') ? '&' : '?';
  return `${clean}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function normalizeReferralCode(value) {
  const clean = String(value || '')
    .trim()
    .replace(/^ref(?:erral)?[_:-]?/i, '')
    .replace(/^agent[_:-]?/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 48);
  return clean.replace(/^agent_/, '');
}

function webAppUrlForChat(chatId, extra = {}) {
  let url = WEBAPP_URL;
  const referralCode = normalizeReferralCode(extra.referralCode || chatReferrals.get(String(chatId)));
  if (referralCode) url = withWebAppParam(url, 'ref', referralCode);
  for (const [key, value] of Object.entries(extra)) {
    if (key === 'referralCode' || value === undefined || value === null || value === '') continue;
    url = withWebAppParam(url, key, value);
  }
  return url;
}

function webAppButton(text, url) {
  return isHttpsUrl(url) ? { text, web_app: { url } } : { text, url };
}

function label(icon, text) {
  return `${icon} ${text}`;
}

function cleanPhone(value) {
  return canonicalEthiopianPhone(value);
}

function gameKeyboard(lang = 'en', chatId = '') {
  if (!WEBAPP_URL) return undefined;
  return { inline_keyboard: [[webAppButton(label('\uD83C\uDFAE', t(lang, 'playNow')), webAppUrlForChat(chatId))]] };
}

function inviteKeyboard(lang = 'en') {
  const botUrl = `https://t.me/${BOT_USERNAME}?start=invite`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(botUrl)}&text=${encodeURIComponent(t(lang, 'inviteMessage'))}`;
  return {
    inline_keyboard: [[{ text: label('\uD83D\uDCE8', t(lang, 'inviteFriends')), url: shareUrl }]],
  };
}

function loginKeyboard(lang = 'en', chatId = '') {
  if (!WEBAPP_URL) return mainMenuKeyboard(lang);
  return {
    inline_keyboard: [
      [webAppButton(label('\uD83D\uDD10', t(lang, 'loginButton')), webAppUrlForChat(chatId, { tg_login: 'bot' }))],
      [{ text: label('\uD83D\uDCDD', t(lang, 'registerLinkWallet')), callback_data: 'menu:register' }],
    ],
  };
}

function userLang(chatId) {
  return chatLanguages.get(String(chatId)) || 'am';
}

function formatText(template, values = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

const I18N = {
  en: {
    playNow: 'Play Now',
    loginButton: 'Login',
    depositMoney: 'Deposit Money',
    withdrawMoney: 'Withdraw Money',
    registerLinkWallet: 'Register / Link Wallet',
    inviteFriends: 'Invite Friends',
    inviteMessage: 'Join me on HabeshaBingo. Open the bot to register and play.',
    myBalance: 'My Balance',
    talkSupport: 'Talk to Support',
    howItWorks: 'How It Works',
    howToPlay: 'How to Play',
    policiesButton: 'Policies',
    readPolicies: 'Read Policies',
    cancel: 'Cancel',
    yes: 'Yes',
    no: 'No',
    sharePhone: 'Share Phone Number',
    ageConfirmButton: 'I am 18+ and accept policies',
    confirmCreateWallet: 'Confirm & Create Wallet',
    startOver: 'Start Over',
    confirmWithdrawal: 'Confirm Withdrawal',
    languageButton: 'አማርኛ',
    welcome: 'Welcome to HabeshaBingo, {name}!',
    welcomeLine1: 'Play fun games and win real money instantly.',
    welcomeLine2: 'Win up to 500,000 Birr on HabeshaBingo.',
    welcomeGames: 'Games: Bingo, Keno, Hi-Lo, Roulette, Crash, and more.',
    welcomeWallet: 'Fast Telebirr deposits. Simple withdrawals. One game wallet.',
    ageRequired: 'Players must be 18+.',
    newHere: 'New here? Tap Register / Link Wallet once to start.',
    wallet: 'Wallet: {name}',
    balance: 'Balance: {balance} ETB',
    howTitle: 'How HabeshaBingo works:',
    how1: '1. Register / Link Wallet once.',
    how2: '2. Deposit by Telebirr.',
    how3: '3. Open the game and play.',
    how4: '4. Withdraw winnings with your 4 digit PIN.',
    gameRulesTitle: 'How to Play HabeshaBingo games:',
    bingoRules: 'Bingo: choose a bet, pick a cartela, follow called numbers, tap Check when you have a called number, and press BINGO only when you complete a valid line.',
    kenoRules: 'Keno: pick 1-20 numbers, choose your stake, then 20 numbers are drawn. More matches pay higher prizes according to the displayed table.',
    rouletteRules: 'Roulette: choose your chip amount and bet spots, then press Spin. The wheel lands on one number and the result is paid according to the roulette prize rules.',
    supportRules: 'You can always ask support from this menu if anything is unclear.',
    needHelp: 'Need help? Tap Talk to Support.',
    createWalletIntro: 'Let us create your HabeshaBingo wallet.',
    ageConfirmIntro: 'First, read the HabeshaBingo policies, then confirm that you are above 18 years old and accept them.',
    sendFullName: 'Great. Please send your full name.',
    pleaseFullName: 'Please send your full name.',
    shareTelegramPhone: 'Tap the button below to share your Telegram phone number, or type your Ethiopian phone number.',
    tapSharePhone: 'Please share your phone using the button, or type a valid Ethiopian phone number like 09**.',
    shareOwnPhone: 'Please share your own Telegram phone number.',
    phoneRejected: 'That phone number is not accepted. Please share an Ethiopian 09 or 07 number.',
    phoneReceived: 'Phone received. Please create a 4 digit PIN for withdrawals.',
    createPin: 'Create 4 digit PIN',
    pin4: 'PIN must be exactly 4 digits.',
    confirmRegistration: 'Please confirm your registration:',
    fullName: 'Full name: {fullName}',
    phone: 'Phone: {phone}',
    telegramUsername: 'Telegram username: {username}',
    chatId: 'Chat ID: {chatId}',
    ageConfirmed: 'Age: confirmed above 18',
    policyAccepted: 'Policy: accepted',
    ifCorrectCreate: 'If everything is correct, press Confirm & Create Wallet.',
    walletCreated: 'Wallet created successfully.',
    walletLinked: 'Wallet linked successfully.',
    nameLine: 'Name: {name}',
    chooseFirstDeposit: 'Choose your first deposit amount below.',
    depositSelected: 'Deposit selected.',
    currentBalance: 'Current balance: {balance} ETB',
    chooseDepositAmount: 'Choose deposit amount:',
    depositAmount: 'Deposit amount: {amount} ETB',
    depositUsePhone: 'Is {phone} the phone number you will use for this payment?',
    depositWhichPhone: 'Which phone number will you use for this payment?',
    chooseDepositValid: 'Choose one of the deposit amount buttons, or type a valid amount.',
    typeDepositPhone: 'Type the full phone number you will pay from by Telebirr.',
    pleaseDepositPhone: 'Please type the full phone number you will pay from.',
    examplePhone: 'Example: 09**',
    depositCreated: 'Deposit request created.',
    amountLine: 'Amount: {amount} ETB',
    telebirrReceiver: 'Telebirr receiver:',
    tapCopy: 'Tap the number above to copy it.',
    depositAutoUpdate: 'Once you complete the Telebirr payment, your game wallet is credited automatically and usually immediately after confirmation.',
    withdrawSelected: 'Withdrawal selected.',
    availableBalance: 'Available balance: {balance} ETB',
    chooseWithdrawAmount: 'Choose withdrawal amount:',
    withdrawAmount: 'Withdrawal amount: {amount} ETB',
    payoutWhere: 'Is {phone} your Telebirr account for receiving this payout?',
    typePayoutPhone: 'Type the full phone number where you want to receive the payout.',
    pleasePayoutPhone: 'Please type the full phone number for payout.',
    sendWithdrawPin: 'Send your 4 digit withdrawal PIN.',
    confirmWithdrawText: 'Please confirm withdrawal:',
    payoutPhone: 'Payout phone: {phone}',
    withdrawSent: 'Withdrawal request sent.',
    adminProcess: 'This amount is reserved from your playable balance until admin approval or rejection.',
    supportReceived: 'Support request received.',
    supportAsk: 'Please type your support question or issue now.',
    supportSoon: 'An admin will contact you here as soon as possible.',
    supportUrgent: 'For urgent wallet issues, send your phone number, amount, and transaction reference.',
    langAm: 'Language changed to Amharic.',
    langEn: 'Language changed to English.',
    registrationExpired: 'Registration session expired. Press Register again.',
    depositExpired: 'Deposit session expired. Press Deposit again.',
    withdrawExpired: 'Withdrawal session expired. Press Withdraw again.',
    registerFirst: 'Use Register / Link first.',
    useMenu: 'Use /menu to open the buttons.',
    openGame: 'Open the game below.',
    telegramId: 'Telegram ID: {id}',
    cancelled: 'Cancelled.',
    walletBalance: 'Wallet balance: {balance} ETB\nName: {name}',
    depositCommandHelp: 'Use: /deposit 500 09**\n\nThe phone number must be the number you will send money from.',
    chooseWithdrawValid: 'Choose one of the withdrawal amount buttons, or type any valid custom amount. Minimum is 50 ETB.',
    typeCustomAmount: 'Type custom amount',
    ifCorrectWithdraw: 'If everything is correct, press Confirm Withdrawal.',
    logoutButton: 'Logout',
    loggedOut: 'You have been logged out. Your session is ended.',
    loginPrompt: 'Open the Mini App below to login again.',
    logoutConfirm: 'Are you sure you want to log out? You will need to login again to play.',
  },
  am: {
    playNow: 'አሁኑኑ ይጫወቱ',
    loginButton: 'ግባ',
    depositMoney: 'ገንዘብ ያስገቡ',
    withdrawMoney: 'ገንዘብ ያውጡ',
    registerLinkWallet: 'ይመዝገቡ / አካውንት ያገናኙ',
    myBalance: 'ቀሪ ሂሳቤ',
    talkSupport: 'ድጋፍ ሰጪዎችን ያነጋግሩ',
    howItWorks: 'እንዴት እንደሚሰራ',
    howToPlay: 'እንዴት መጫወት እንደሚቻል',
    policiesButton: 'ፖሊሲዎች',
    readPolicies: 'ፖሊሲዎችን ያንብቡ',
    cancel: 'ሰርዝ',
    yes: 'አዎ',
    no: 'አይደለም',
    sharePhone: 'ስልክ ቁጥር ያጋሩ',
    ageConfirmButton: '18+ መሆኔን እና ፖሊሲዎቹን መቀበሌን አረጋግጣለሁ',
    confirmCreateWallet: 'አረጋግጥ እና አካውንት ፍጠር',
    startOver: 'እንደገና ጀምር',
    confirmWithdrawal: 'ማውጣቱን አረጋግጥ',
    languageButton: 'English',
    welcome: 'እንኳን ወደ ሐበሻቢንጎ በደህና መጡ፣ {name}!',
    welcomeLine1: 'አዝናኝ ጨዋታዎችን ይጫወቱ እና ወዲያውኑ እውነተኛ ገንዘብ ያሸንፉ።',
    welcomeLine2: 'በሐበሻቢንጎ እስከ 500,000 ብር ያሸንፉ።',
    welcomeGames: 'ጨዋታዎች፡ ቢንጎ፣ ኬኖ፣ ሃይ-ሎ፣ ሩሌት፣ ክራሽ እና ሌሎችም።',
    welcomeWallet: 'ፈጣን የቴሌብር ተቀማጭ። ቀላል ገንዘብ ማውጣት። አንድ የጨዋታ አካውንት።',
    ageRequired: 'ተጫዋቾች ዕድሜያቸው 18+ መሆን አለበት።',
    newHere: 'አዲስ ነዎት? ለመጀመር «ይመዝገቡ / አካውንት ያገናኙ» የሚለውን አንዴ ይጫኑ።',
    wallet: 'አካውንት: {name}',
    balance: 'ቀሪ ሂሳብ: {balance} ብር',
    howTitle: 'ሐበሻቢንጎ እንዴት እንደሚሰራ፡',
    how1: '1. ይመዝገቡ / አካውንት ያገናኙ (አንዴ ብቻ)።',
    how2: '2. በቴሌብር ገንዘብ ያስገቡ።',
    how3: '3. ጨዋታውን ከፍተው ይጫወቱ።',
    how4: '4. ያሸነፉትን ገንዘብ በ4 አሃዝ ሚስጥር ቁጥርዎ (PIN) ያውጡ።',
    gameRulesTitle: 'የሐበሻቢንጎ ጨዋታዎች እንዴት እንደሚጫወቱ፡',
    bingoRules: 'ቢንጎ፡ የቤት መጠን ይምረጡ፣ ካርቴላ ይምረጡ፣ የተጠሩትን ቁጥሮች ይከታተሉ፣ ያለዎት ቁጥር ሲጠራ Check ይጫኑ፣ ትክክለኛ መስመር ሲሞላ BINGO ይጫኑ።',
    kenoRules: 'ኬኖ፡ ከ1-20 ቁጥሮች ይምረጡ፣ ቤት ይምረጡ፣ 20 ቁጥሮች ይወጣሉ። ብዙ ቁጥሮች ሲገጥሙ ከፍ ያለ ሽልማት ያገኛሉ።',
    rouletteRules: 'ሩሌት፡ የቺፕ መጠን እና የሚጫወቱበትን ቦታ ይምረጡ፣ ከዚያ Spin ይጫኑ። ዊሉ በአንድ ቁጥር ላይ ይቆማል፣ ውጤቱም በሩሌት የሽልማት ህግ መሰረት ይከፈላል።',
    supportRules: 'ግልጽ ያልሆነ ነገር ካለ ሁልጊዜ ከዚህ ሜኑ ድጋፍ መጠየቅ ይችላሉ።',
    needHelp: 'እርዳታ ይፈልጋሉ? «ድጋፍ ሰጪዎችን ያነጋግሩ» የሚለውን ይጫኑ።',
    createWalletIntro: 'የሐበሻቢንጎ አካውንትዎን እንፍጠር።',
    ageConfirmIntro: 'በመጀመሪያ የሐበሻቢንጎ ፖሊሲዎችን ያንብቡ፤ ከዚያ ዕድሜዎ ከ18 ዓመት በላይ መሆኑን እና ፖሊሲዎቹን መቀበልዎን ያረጋግጡ።',
    sendFullName: 'በጣም ጥሩ። እባክዎ ሙሉ ስምዎን ይላኩ።',
    pleaseFullName: 'እባክዎ ሙሉ ስምዎን ይላኩ።',
    shareTelegramPhone: 'አሁን የቴሌግራም ስልክ ቁጥርዎን ለማጋራት ከታች ያለውን አዝራር ይጫኑ።',
    tapSharePhone: 'እባክዎ «ስልክ ቁጥር ያጋሩ» የሚለውን ይጫኑ። ስልክ ቁጥሩን በፅሁፍ አያስገቡ።',
    shareOwnPhone: 'እባክዎ የራስዎን የቴሌግራም ስልክ ቁጥር ያጋሩ።',
    phoneRejected: 'ያ ስልክ ቁጥር ተቀባይነት የለውም። እባክዎ በ09 ወይም በ07 የሚጀምር የኢትዮጵያ ስልክ ቁጥር ያጋሩ።',
    phoneReceived: 'ስልክ ቁጥርዎ ተቀብለናል። እባክዎ ገንዘብ ለማውጣት የሚያገለግል የ4 አሃዝ ሚስጥር ቁጥር (PIN) ይፍጠሩ።',
    createPin: 'የ4 አሃዝ ሚስጥር ቁጥር ይፍጠሩ',
    pin4: 'ሚስጥር ቁጥሩ (PIN) በትክክል 4 አሃዝ መሆን አለበት።',
    confirmRegistration: 'እባክዎ ምዝገባዎን ያረጋግጡ፡',
    fullName: 'ሙሉ ስም: {fullName}',
    phone: 'ስልክ: {phone}',
    telegramUsername: 'የቴሌግራም መለያ (Username): {username}',
    chatId: 'የቻት መታወቂያ (Chat ID): {chatId}',
    ageConfirmed: 'ዕድሜ፡ ከ18 በላይ መሆኑ የተረጋገጠ',
    policyAccepted: 'ፖሊሲ፡ ተቀብለዋል',
    ifCorrectCreate: 'ሁሉም ነገር ትክክል ከሆነ «አረጋግጥ እና አካውንት ፍጠር» የሚለውን ይጫኑ።',
    walletCreated: 'አካውንትዎ በተሳካ ሁኔታ ተፈጥሯል።',
    walletLinked: 'አካውንትዎ በተሳካ ሁኔታ ተገናኝቷል።',
    nameLine: 'ስም: {name}',
    chooseFirstDeposit: 'እባክዎ የመጀመሪያ ተቀማጭ ገንዘብዎን መጠን ከታች ይምረጡ።',
    depositSelected: 'ገንዘብ ማስገባት ተመርጧል።',
    currentBalance: 'የአሁኑ ቀሪ ሂሳብ: {balance} ብር',
    chooseDepositAmount: 'የሙላቱን መጠን ይምረጡ፡',
    depositAmount: 'የሙላት መጠን: {amount} ብር',
    depositUsePhone: 'ለዚህ ክፍያ የሚጠቀሙበት ስልክ ቁጥር {phone} ነው?',
    depositWhichPhone: 'ለዚህ ክፍያ የትኛውን ስልክ ቁጥር ይጠቀማሉ?',
    chooseDepositValid: 'ከታች ካሉት የገንዘብ መጠን አዝራሮች አንዱን ይምረጡ፣ ወይም ትክክለኛ መጠን ይተይቡ።',
    typeDepositPhone: 'በቴሌብር የሚከፍሉበትን ሙሉ ስልክ ቁጥር ይተይቡ።',
    pleaseDepositPhone: 'እባክዎ የሚከፍሉበትን ሙሉ ስልክ ቁጥር ይተይቡ።',
    examplePhone: 'ምሳሌ፡ 0912345678',
    depositCreated: 'የገንዘብ ማስገቢያ ጥያቄ ተፈጥሯል።',
    amountLine: 'መጠን: {amount} ብር',
    telebirrReceiver: 'የቴሌብር ተቀባይ፡',
    tapCopy: 'ቁጥሩን ለመቅዳት (Copy ለማድረግ) ከላይ ያለውን ቁጥር ይጫኑ።',
    depositAutoUpdate: 'የቴሌብር ክፍያውን እንዳጠናቀቁ፣ ወደ የጌም ዋሌትዎ ወዲያውኑ ገቢ ይደረጋል።',
    withdrawSelected: 'ገንዘብ ማውጣት ተመርጧል።',
    availableBalance: 'ሊወጣ የሚችል ቀሪ ሂሳብ: {balance} ብር',
    chooseWithdrawAmount: 'የሚወጣውን ገንዘብ መጠን ይምረጡ፡',
    withdrawAmount: 'የገንዘብ ማውጫ መጠን: {amount} ብር',
    payoutWhere: '{phone} ገንዘቡ የሚላክበት የቴሌብር አካውንትዎ ነው?',
    typePayoutPhone: 'ገንዘቡ እንዲላክበት የሚፈልጉትን ሙሉ ስልክ ቁጥር ይተይቡ።',
    pleasePayoutPhone: 'እባክዎ ገንዘብ የሚላክበትን ሙሉ ስልክ ቁጥር ይተይቡ።',
    sendWithdrawPin: 'የ4 አሃዝ የገንዘብ ማውጫ ሚስጥር ቁጥርዎን (PIN) ይላኩ።',
    confirmWithdrawText: 'እባክዎ ገንዘብ ማውጣቱን ያረጋግጡ፡',
    payoutPhone: 'የሚላክበት ስልክ: {phone}',
    withdrawSent: 'የገንዘብ ማውጫ ጥያቄ ተልኳል።',
    adminProcess: 'ይህ መጠን አስተዳዳሪ እስኪያረጋግጠው ወይም እስኪሰርዘው ድረስ ከመጫወቻ ቀሪ ሂሳብዎ ይያዛል።',
    supportReceived: 'የድጋፍ ጥያቄዎ ተቀብለናል።',
    supportAsk: 'እባክዎ የድጋፍ ጥያቄዎን ወይም ችግሩን አሁን ይጻፉ።',
    supportSoon: 'አንድ አስተዳዳሪ በተቻለ ፍጥነት እዚህ ያገኝዎታል።',
    supportUrgent: 'ለአስቸኳይ የአካውንት ችግሮች፡ ስልክ ቁጥርዎን፣ የገንዘቡን መጠን እና የግብይት መለያ ቁጥር (Transaction Reference) ይላኩ።',
    langAm: 'ቋንቋ ወደ አማርኛ ተቀይሯል።',
    langEn: 'ቋንቋ ወደ እንግሊዘኛ ተቀይሯል።',
    registrationExpired: 'የምዝገባው ጊዜ አልፎበታል። እባክዎ እንደገና «ይመዝገቡ» የሚለውን ይጫኑ።',
    depositExpired: 'የገንዘብ ማስገቢያው ጊዜ አልፎበታል። እባክዎ እንደገና «ገንዘብ ያስገቡ» የሚለውን ይጫኑ።',
    withdrawExpired: 'የገንዘብ ማውጫው ጊዜ አልፎበታል። እባክዎ እንደገና «ገንዘብ ያውጡ» የሚለውን ይጫኑ።',
    registerFirst: 'መጀመሪያ «ይመዝገቡ / አካውንት ያገናኙ» የሚለውን ይጠቀሙ።',
    useMenu: 'አዝራሮቹን ለመክፈት /menu ይጠቀሙ።',
    openGame: 'ጨዋታውን ከታች ይክፈቱ።',
    telegramId: 'የቴሌግራም መታወቂያ (ID): {id}',
    cancelled: 'ተሰርዟል።',
    walletBalance: 'ቀሪ ሂሳብ: {balance} ብር\nስም: {name}',
    depositCommandHelp: 'እባክዎ መጀመሪያ የገንዘብ መጠን እና የሚከፍሉበትን ስልክ ቁጥር ይምረጡ።',
    logoutButton: 'ውጣ',
    loggedOut: 'ከአካውንትዎ ወጥተዋል። ክፍለ-ጊዜዎ ተጠናቋል።',
    loginPrompt: 'እንደገና ለመግባት ከታች ያለውን Mini App ይክፈቱ።',
    logoutConfirm: 'እርግጠኛ ነዎት መውጣት ይፈልጋሉ? እንደገና ለመጫወት መግባት ያስፈልግዎታል።',
    chooseWithdrawValid: 'ከታች ካሉት የገንዘብ መጠን አዝራሮች አንዱን ይምረጡ፣ ወይም የሚፈልጉትን ትክክለኛ መጠን ይተይቡ። ዝቅተኛው 50 ብር ነው።',
    typeCustomAmount: 'የፈለጉትን መጠን ይጻፉ',
    ifCorrectWithdraw: 'ሁሉም ነገር ትክክል ከሆነ «ማውጣቱን አረጋግጥ» የሚለውን ይጫኑ።',
  },
};

Object.assign(I18N.am, {
  inviteFriends: 'ጓደኞችን ጋብዝ',
  inviteMessage: 'በሐበሻቢንጎ ከእኔ ጋር ይቀላቀሉ። ለመመዝገብ እና ለመጫወት ቦቱን ይክፈቱ።',
  shareTelegramPhone: 'የቴሌግራም ስልክ ቁጥርዎን ለማጋራት ከታች ያለውን ቁልፍ ይጫኑ፣ ወይም የኢትዮጵያ ስልክ ቁጥርዎን ያስገቡ።',
  tapSharePhone: 'እባክዎ ቁልፉን በመጠቀም ስልክዎን ያጋሩ፣ ወይም እንደ 09** ያለ ትክክለኛ የኢትዮጵያ ስልክ ቁጥር ያስገቡ።',
  examplePhone: 'ምሳሌ፡ 09**',
});

function t(langOrChatId, key, values = {}) {
  const lang = langOrChatId === 'am' || langOrChatId === 'en' ? langOrChatId : userLang(langOrChatId);
  const template = I18N[lang]?.[key] ?? I18N.en[key] ?? key;
  return formatText(template, values);
}

function mainMenuKeyboard(lang = 'en', chatId = '') {
  const openButton = webAppButton(label('\uD83C\uDFAE', t(lang, 'playNow')), webAppUrlForChat(chatId));
  const loginButton = webAppButton(label('\uD83D\uDD10', t(lang, 'loginButton')), webAppUrlForChat(chatId, { tg_login: 'bot' }));
  return {
    inline_keyboard: [
      [openButton, loginButton],
      [
        { text: label('💰', t(lang, 'depositMoney')), callback_data: 'menu:deposit' },
        { text: label('🏦', t(lang, 'withdrawMoney')), callback_data: 'menu:withdraw' },
      ],
      [
        { text: label('📝', t(lang, 'registerLinkWallet')), callback_data: 'menu:register' },
        { text: label('💳', t(lang, 'myBalance')), callback_data: 'menu:balance' },
      ],
      [
        { text: label('🎧', t(lang, 'talkSupport')), callback_data: 'menu:support' },
        { text: label('🌐', t(lang, 'languageButton')), callback_data: lang === 'am' ? 'lang:en' : 'lang:am' },
      ],
      [{ text: label('📨', t(lang, 'inviteFriends')), callback_data: 'menu:invite' }],
      [{ text: label('ℹ️', t(lang, 'howItWorks')), callback_data: 'menu:help' }, { text: label('❔', t(lang, 'howToPlay')), callback_data: 'menu:howplay' }],
      [{ text: label('📜', t(lang, 'policiesButton')), callback_data: 'menu:policies' }],
      [{ text: label('🚪', t(lang, 'logoutButton')), callback_data: 'menu:logout' }],
    ],
  };
}

function cancelKeyboard(lang = 'en') {
  return { inline_keyboard: [[{ text: label('✖️', t(lang, 'cancel')), callback_data: 'flow:cancel' }]] };
}

function contactKeyboard(lang = 'en') {
  return {
    keyboard: [[{ text: label('📱', t(lang, 'sharePhone')), request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function removeKeyboard() {
  return { remove_keyboard: true };
}

function yesNoKeyboard(yesData, noData, lang = 'en') {
  return {
    inline_keyboard: [
      [{ text: label('✅', t(lang, 'yes')), callback_data: yesData }, { text: label('✏️', t(lang, 'no')), callback_data: noData }],
      [{ text: label('✖️', t(lang, 'cancel')), callback_data: 'flow:cancel' }],
    ],
  };
}

function ageKeyboard(lang = 'en') {
  return {
    inline_keyboard: [
      [{ text: label('📜', t(lang, 'readPolicies')), callback_data: 'register:policy' }],
      [{ text: label('✅', t(lang, 'ageConfirmButton')), callback_data: 'register:age:yes' }],
      [{ text: label('✖️', t(lang, 'cancel')), callback_data: 'flow:cancel' }],
    ],
  };
}

function registerConfirmKeyboard(lang = 'en') {
  return {
    inline_keyboard: [
      [{ text: label('✅', t(lang, 'confirmCreateWallet')), callback_data: 'register:confirm' }],
      [{ text: label('↩️', t(lang, 'startOver')), callback_data: 'menu:register' }, { text: label('✖️', t(lang, 'cancel')), callback_data: 'flow:cancel' }],
    ],
  };
}

function depositAmountKeyboard(lang = 'en') {
  return {
    inline_keyboard: [
      [
        { text: '💵 50 ETB', callback_data: 'deposit:amount:50' },
        { text: '💵 100 ETB', callback_data: 'deposit:amount:100' },
        { text: '💵 200 ETB', callback_data: 'deposit:amount:200' },
      ],
      [
        { text: '💵 500 ETB', callback_data: 'deposit:amount:500' },
        { text: '💵 1,000 ETB', callback_data: 'deposit:amount:1000' },
      ],
      [
        { text: '💵 5,000 ETB', callback_data: 'deposit:amount:5000' },
        { text: '💵 10,000 ETB', callback_data: 'deposit:amount:10000' },
      ],
      [{ text: label('⌨️', t(lang, 'typeCustomAmount')), callback_data: 'deposit:custom' }],
      [{ text: label('✖️', t(lang, 'cancel')), callback_data: 'flow:cancel' }],
    ],
  };
}

function withdrawAmountKeyboard(lang = 'en') {
  return {
    inline_keyboard: [
      [
        { text: '🏦 50 ETB', callback_data: 'withdraw:amount:50' },
        { text: '🏦 100 ETB', callback_data: 'withdraw:amount:100' },
        { text: '🏦 200 ETB', callback_data: 'withdraw:amount:200' },
      ],
      [
        { text: '🏦 500 ETB', callback_data: 'withdraw:amount:500' },
        { text: '🏦 1,000 ETB', callback_data: 'withdraw:amount:1000' },
      ],
      [
        { text: '🏦 5,000 ETB', callback_data: 'withdraw:amount:5000' },
        { text: '🏦 10,000 ETB', callback_data: 'withdraw:amount:10000' },
      ],
      [{ text: label('⌨️', t(lang, 'typeCustomAmount')), callback_data: 'withdraw:custom' }],
      [{ text: label('✖️', t(lang, 'cancel')), callback_data: 'flow:cancel' }],
    ],
  };
}

function withdrawConfirmKeyboard(lang = 'en') {
  return {
    inline_keyboard: [
      [{ text: label('✅', t(lang, 'confirmWithdrawal')), callback_data: 'withdraw:confirm' }],
      [{ text: label('✖️', t(lang, 'cancel')), callback_data: 'flow:cancel' }],
    ],
  };
}

function logoutConfirmKeyboard(lang = 'en') {
  return {
    inline_keyboard: [
      [{ text: label('🚪', t(lang, 'logoutButton')), callback_data: 'logout:confirm' }],
      [{ text: label('↩️', t(lang, 'cancel')), callback_data: 'flow:cancel' }],
    ],
  };
}

async function tg(method, payload) {
  if (!TOKEN) throw new Error('Telegram bot token is not configured yet.');
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

async function serverApi(path, options = {}) {
  const res = await fetch(`${SERVER_API_URL.replace(/\/$/, '')}${path}`, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${BOT_SERVER_API_KEY}`,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Server API failed (${res.status})`);
  return data;
}

async function refreshBotConfig(force = false) {
  if (!force && Date.now() - lastConfigCheck < 60_000) return false;
  lastConfigCheck = Date.now();
  try {
    const data = await serverApi('/api/bot/config');
    const configuredUsername = String(data.botUsername || '').trim().replace(/^@/, '');
    if (/^[a-zA-Z0-9_]{5,32}$/.test(configuredUsername)) BOT_USERNAME = configuredUsername;
    const nextToken = String(data.botToken || '').trim();
    if (nextToken && nextToken !== TOKEN) {
      TOKEN = nextToken;
      offset = 0;
      BOT_READY = false;
      console.log('Bot token loaded or reloaded from server.');
      return true;
    }
  } catch (error) {
    console.error('Bot config refresh error:', error.message);
  }
  return false;
}

async function sendMessage(chatId, text, extra = {}) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...extra,
  });
}

async function sendPhoto(chatId, photo, caption = '', extra = {}) {
  return tg('sendPhoto', {
    chat_id: chatId,
    photo,
    caption,
    ...extra,
  });
}

function friendlyError(error, lang = 'en') {
  const message = String(error?.message || error || '').trim();
  if (/no linked game account|no game account is linked|register/i.test(message)) {
    return t(lang, 'registerFirst');
  }
  if (/server api failed|fetch failed|ECONNREFUSED|timeout/i.test(message)) {
    return lang === 'am'
      ? 'ሲስተሙ ለጊዜው አልተገናኘም። እባክዎ ትንሽ ቆይተው ይሞክሩ።'
      : 'The service is temporarily unavailable. Please try again shortly.';
  }
  return message || (lang === 'am' ? 'ይቅርታ፣ እባክዎ እንደገና ይሞክሩ።' : 'Sorry, please try again.');
}

function welcomeText(name = 'player', linked = null, lang = 'en') {
  const status = linked
    ? `✅ ${t(lang, 'wallet', { name: linked.name })}\n💳 ${t(lang, 'balance', { balance: linked.balance })}`
    : t(lang, 'newHere');
  return `🏆 ${t(lang, 'welcome', { name })}\n\n` +
    `🎮 ${t(lang, 'welcomeLine1')}\n` +
    `💰 ${t(lang, 'welcomeLine2')}\n\n` +
    `🎲 ${t(lang, 'welcomeGames')}\n` +
    `⚡ ${t(lang, 'welcomeWallet')}\n\n` +
    `🔞 ${t(lang, 'ageRequired')}\n\n` +
    `${status}`;
}

function helpText(lang = 'en') {
  return `ℹ️ ${t(lang, 'howTitle')}\n\n` +
    `1️⃣ ${t(lang, 'how1').replace(/^1\.\s*/, '')}\n` +
    `2️⃣ ${t(lang, 'how2').replace(/^2\.\s*/, '')}\n` +
    `3️⃣ ${t(lang, 'how3').replace(/^3\.\s*/, '')}\n` +
    `4️⃣ ${t(lang, 'how4').replace(/^4\.\s*/, '')}\n\n` +
    `🎧 ${t(lang, 'needHelp')}\n` +
    `🔞 ${t(lang, 'ageRequired')}`;
}

function gameRulesText(lang = 'en') {
  return `❔ ${t(lang, 'gameRulesTitle')}\n\n` +
    `🎱 ${t(lang, 'bingoRules')}\n\n` +
    `🔴 ${t(lang, 'kenoRules')}\n\n` +
    `🎡 ${t(lang, 'rouletteRules')}\n\n` +
    `🎧 ${t(lang, 'supportRules')}`;
}

function fallbackPolicyText(lang = 'en') {
  if (lang === 'am') {
    return [
      'የሐበሻቢንጎ የተጫዋች ፖሊሲ',
      '',
      'ሐበሻቢንጎ ለመዝናናት እና በኃላፊነት ለመጫወት የተዘጋጀ ነው።',
      'ተጫዋቾች 18+ መሆን አለባቸው።',
      'ጨዋታዎቹ የገቢ ምንጭ ሳይሆኑ ለመዝናናት ብቻ ናቸው።',
      'የተደበቁ ክፍያዎች የሉም። የቢንጎ ኮሚሽን 15%፣ የማውጫ ክፍያ 2%፣ ከፍተኛ የቀን ማውጫ 10,000 ብር ነው።',
      'አካውንት በመፍጠር ዕድሜዎ 18+ መሆኑን እና ፖሊሲዎቹን መቀበልዎን ያረጋግጣሉ።',
    ].join('\n');
  }
  return [
    'HabeshaBingo Player Policy',
    '',
    'HabeshaBingo is built for fun, entertainment, and responsible play.',
    'Players must be 18 years or older.',
    'Games are entertainment only and must not be used as a guaranteed income source.',
    'There are no hidden charges. Current fees: Bingo commission 15%, withdrawal fee 2%, maximum daily withdrawal 10,000 ETB.',
    'By creating an account, you confirm that you are 18+ and accept these policies.',
  ].join('\n');
}

async function loadPolicyText(lang = 'en') {
  try {
    const data = await serverApi('/api/public-settings');
    const policies = data?.policies || {};
    const title = String(policies.title || '').trim();
    const body = String(policies.body || '').trim();
    if (title || body) return `${title || 'HabeshaBingo Player Policy'}\n\n${body || fallbackPolicyText(lang)}`;
  } catch (_) {
    // Fall through to a local policy summary if the game server is briefly unavailable.
  }
  return fallbackPolicyText(lang);
}

async function sendLongMessage(chatId, text, extra = {}) {
  let remaining = String(text || '');
  const chunks = [];
  while (remaining.length > 3800) {
    let cut = remaining.lastIndexOf('\n', 3800);
    if (cut < 1200) cut = 3800;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  for (let i = 0; i < chunks.length; i += 1) {
    await sendMessage(chatId, chunks[i], i === chunks.length - 1 ? extra : {});
  }
}

async function sendPolicies(chatId, replyMarkup) {
  const lang = userLang(chatId);
  const text = await loadPolicyText(lang);
  await sendLongMessage(chatId, text, { reply_markup: replyMarkup || mainMenuKeyboard(lang) });
}

async function sendWelcome(chatId, user) {
  const name = user?.first_name || 'player';
  const lang = userLang(chatId);
  let linked = null;
  try {
    const profile = await serverApi(`/api/bot/profile/${user.id}`);
    linked = profile.account;
  } catch (_) {
    linked = null;
  }
  const text = welcomeText(name, linked, lang);
  if (BOT_WELCOME_PHOTO_URL && isHttpsUrl(BOT_WELCOME_PHOTO_URL)) {
    try {
      await sendPhoto(chatId, BOT_WELCOME_PHOTO_URL, text.slice(0, 1000), { reply_markup: mainMenuKeyboard(lang, chatId) });
      return;
    } catch (error) {
      console.error('Welcome photo failed:', error.message);
    }
  }
  await sendMessage(chatId, text, { reply_markup: mainMenuKeyboard(lang, chatId) });
}

async function answerCallback(id, text = '') {
  if (!id) return;
  await tg('answerCallbackQuery', { callback_query_id: id, text }).catch(() => {});
}

async function handleRegister(message, parts) {
  await startRegisterFlow(message.chat.id, message.from);
}

async function startRegisterFlow(chatId, user = null) {
  const lang = userLang(chatId);
  if (user?.id) {
    try {
      const profile = await serverApi(`/api/bot/profile/${user.id}`);
      await sendMessage(
        chatId,
        `${t(lang, 'walletLinked')}\n\n` +
          `${t(lang, 'nameLine', { name: profile.account.name })}\n` +
          `${t(lang, 'phone', { phone: profile.account.phone })}\n` +
          `${t(lang, 'balance', { balance: profile.account.balance })}`,
        { reply_markup: mainMenuKeyboard(lang) }
      );
      return;
    } catch (_) {
      // Not linked yet; continue with registration.
    }
  }
  chatFlows.set(String(chatId), { type: 'register_age', referralCode: normalizeReferralCode(chatReferrals.get(String(chatId))) });
  await sendMessage(
    chatId,
    `📝 ${t(lang, 'createWalletIntro')}\n\n🛡️ ${t(lang, 'ageConfirmIntro')}`,
    { reply_markup: ageKeyboard(lang) }
  );
}

async function startSupportFlow(chatId, user) {
  const lang = userLang(chatId);
  chatFlows.set(String(chatId), { type: 'support_message', user });
  await sendMessage(chatId, t(lang, 'supportAsk'), { reply_markup: cancelKeyboard(lang) });
}

async function sendSupportRequest(chatId, user, messageText = '') {
  const lang = userLang(chatId);
  try {
    await serverApi('/api/bot/support-request', {
      method: 'POST',
      body: {
        telegramId: user?.id,
        username: user?.username || '',
        name: user?.first_name || '',
        message: messageText,
      },
    });
  } catch (_) {
    // The player should still get a useful support prompt if admin notification is temporarily unavailable.
  }
  await sendMessage(
    chatId,
    `🎧 ${t(lang, 'supportReceived')}\n\n${t(lang, 'supportSoon')}\n\n${t(lang, 'supportUrgent')}`,
    { reply_markup: mainMenuKeyboard(lang) }
  );
}

async function startDepositFlow(chatId, user) {
  const lang = userLang(chatId);
  try {
    const profile = await serverApi(`/api/bot/profile/${user.id}`);
    chatFlows.set(String(chatId), { type: 'deposit_amount', account: profile.account });
    await sendMessage(
      chatId,
      `💰 ${t(lang, 'depositSelected')}\n\n💳 ${t(lang, 'currentBalance', { balance: profile.account.balance })}\n\n${t(lang, 'chooseDepositAmount')}`,
      { reply_markup: depositAmountKeyboard(lang) }
    );
  } catch (error) {
    await sendMessage(chatId, `${friendlyError(error, lang)}\n\n${t(lang, 'registerFirst')}`, { reply_markup: mainMenuKeyboard(lang) });
  }
}

async function setDepositAmount(chatId, account, amount) {
  const lang = userLang(chatId);
  const phone = account?.defaultDepositPhone || account?.phone || '';
  chatFlows.set(String(chatId), { type: 'deposit_confirm_phone', account, amount });
  await sendMessage(
    chatId,
    phone
      ? `💰 ${t(lang, 'depositAmount', { amount })}\n\n📱 ${t(lang, 'depositUsePhone', { phone })}`
      : `💰 ${t(lang, 'depositAmount', { amount })}\n\n📱 ${t(lang, 'depositWhichPhone')}`,
    { reply_markup: yesNoKeyboard('deposit:phone:yes', 'deposit:phone:no', lang) }
  );
}

async function startWithdrawFlow(chatId, user) {
  const lang = userLang(chatId);
  try {
    const profile = await serverApi(`/api/bot/profile/${user.id}`);
    chatFlows.set(String(chatId), { type: 'withdraw_amount', account: profile.account });
    await sendMessage(
      chatId,
      `🏦 ${t(lang, 'withdrawSelected')}\n\n💳 ${t(lang, 'availableBalance', { balance: profile.account.balance })}\n\n${t(lang, 'chooseWithdrawAmount')}`,
      { reply_markup: withdrawAmountKeyboard(lang) }
    );
  } catch (error) {
    await sendMessage(chatId, `${friendlyError(error, lang)}\n\n${t(lang, 'registerFirst')}`, { reply_markup: mainMenuKeyboard(lang) });
  }
}

async function setWithdrawAmount(chatId, account, amount) {
  const lang = userLang(chatId);
  chatFlows.set(String(chatId), { type: 'withdraw_confirm_phone', account, amount });
  const phone = account?.defaultDepositPhone || account?.phone || '';
  await sendMessage(
    chatId,
    `🏦 ${t(lang, 'withdrawAmount', { amount })}\n\n📱 ${t(lang, 'payoutWhere', { phone })}`,
    { reply_markup: yesNoKeyboard('withdraw:phone:yes', 'withdraw:phone:no', lang) }
  );
}

async function handleBalance(message) {
  const lang = userLang(message.chat.id);
  const data = await serverApi(`/api/bot/profile/${message.from.id}`);
  await sendMessage(message.chat.id, t(lang, 'walletBalance', { balance: data.account.balance, name: data.account.name }));
}

async function sendInvite(chatId) {
  const lang = userLang(chatId);
  await sendMessage(chatId, t(lang, 'inviteMessage'), { reply_markup: inviteKeyboard(lang) });
}

async function handleDeposit(message, parts) {
  const lang = userLang(message.chat.id);
  const amount = parseInt(parts[1], 10);
  const payerPhone = cleanPhone(parts[2] || '');
  if (!Number.isFinite(amount) || !payerPhone) {
    await sendMessage(message.chat.id, t(lang, 'depositCommandHelp'));
    return;
  }
  const data = await serverApi('/api/bot/deposit-request', {
    method: 'POST',
    body: {
      telegramId: message.from.id,
      username: message.from.username || '',
      name: message.from.first_name || '',
      amount,
      payerPhone,
    },
  });
  await sendMessage(
    message.chat.id,
    `✅ ${t(lang, 'depositCreated')}\n\n` +
      `💰 ${t(lang, 'amountLine', { amount: data.request.amount })}\n` +
      `📲 ${t(lang, 'telebirrReceiver')}\n` +
      `${data.request.depositAccountName || data.request.depositAccountLabel}\n` +
      `<code>${escapeHtml(data.request.depositAccountNumber)}</code>\n\n` +
      `📋 ${t(lang, 'tapCopy')}\n\n` +
      `⚡ ${t(lang, 'depositAutoUpdate')}`,
    { parse_mode: 'HTML', reply_markup: mainMenuKeyboard(lang) }
  );
}

async function handleLogout(message) {
  const chatId = message.chat.id;
  const lang = userLang(chatId);
  chatFlows.delete(String(chatId));
  try {
    await serverApi('/api/bot/logout', {
      method: 'POST',
      body: { telegramId: message.from.id, chatId },
    });
  } catch (e) { /* non-critical */ }
  await sendMessage(chatId, `${t(lang, 'loggedOut')}\n\n${t(lang, 'loginPrompt')}`, { reply_markup: loginKeyboard(lang, chatId) });
}

async function handleWithdraw(message, parts) {
  const lang = userLang(message.chat.id);
  const amount = parseInt(parts[1], 10);
  const pin = parts[2] || '';
  const payoutPhone = cleanPhone(parts[3] || message.from?.phone || '');
  if (!Number.isFinite(amount) || !/^\d{4}$/.test(pin)) {
    await startWithdrawFlow(message.chat.id, message.from);
    return;
  }
  const data = await serverApi('/api/bot/withdraw-request', {
    method: 'POST',
    body: {
      telegramId: message.from.id,
      amount,
      pin,
      payoutPhone,
    },
  });
  await sendMessage(
    message.chat.id,
    `✅ ${t(lang, 'withdrawSent')}\n\n` +
      `💰 ${t(lang, 'amountLine', { amount: data.request.amount })}\n` +
      `📱 ${t(lang, 'payoutPhone', { phone: data.request.payoutPhone })}\n` +
      `💳 ${t(lang, 'balance', { balance: data.account.balance })}\n\n` +
      `🛡️ ${t(lang, 'adminProcess')}`,
    { reply_markup: mainMenuKeyboard(lang) }
  );
}

async function handleFlowMessage(message) {
  const chatId = String(message.chat.id);
  const flow = chatFlows.get(chatId);
  if (!flow) return false;
  const lang = userLang(message.chat.id);
  const text = String(message.text || '').trim();
  if (/^\/cancel$/i.test(text)) {
    chatFlows.delete(chatId);
    await sendMessage(message.chat.id, t(lang, 'cancelled'), { reply_markup: mainMenuKeyboard(lang) });
    return true;
  }

  if (flow.type === 'register_name') {
    const fullName = text.replace(/\s+/g, ' ').trim();
    if (fullName.length < 3 || fullName.length > 80) {
      await sendMessage(message.chat.id, t(lang, 'pleaseFullName'), { reply_markup: cancelKeyboard(lang) });
      return true;
    }
    chatFlows.set(chatId, { ...flow, type: 'register_contact', fullName });
    await sendMessage(
      message.chat.id,
      `📱 ${t(lang, 'shareTelegramPhone')}`,
      { reply_markup: contactKeyboard(lang) }
    );
    return true;
  }

  if (flow.type === 'register_contact') {
    const contact = message.contact;
    if (contact && contact.user_id && String(contact.user_id) !== String(message.from.id)) {
      await sendMessage(message.chat.id, t(lang, 'shareOwnPhone'), { reply_markup: contactKeyboard(lang) });
      return true;
    }
    const phone = cleanPhone(contact ? contact.phone_number : text);
    if (!phone) {
      await sendMessage(message.chat.id, contact ? t(lang, 'phoneRejected') : t(lang, 'tapSharePhone'), { reply_markup: contactKeyboard(lang) });
      return true;
    }
    chatFlows.set(chatId, { ...flow, type: 'register_pin', phone });
    await sendMessage(message.chat.id, `✅ ${t(lang, 'phoneReceived')}`, { reply_markup: removeKeyboard() });
    await sendMessage(message.chat.id, `🔐 ${t(lang, 'createPin')}`, { reply_markup: cancelKeyboard(lang) });
    return true;
  }

  if (flow.type === 'register_pin') {
    if (!/^\d{4}$/.test(text)) {
      await sendMessage(message.chat.id, t(lang, 'pin4'), { reply_markup: cancelKeyboard(lang) });
      return true;
    }
    chatFlows.set(chatId, { ...flow, type: 'register_confirm', pin: text });
    const username = message.from.username ? `@${message.from.username}` : '-';
    await sendMessage(
      message.chat.id,
      `✅ ${t(lang, 'confirmRegistration')}\n\n` +
        `${t(lang, 'fullName', { fullName: flow.fullName })}\n` +
        `${t(lang, 'phone', { phone: flow.phone })}\n` +
        `${t(lang, 'telegramUsername', { username })}\n` +
        `${t(lang, 'chatId', { chatId: message.chat.id })}\n` +
        `${t(lang, 'ageConfirmed')}\n` +
        `${t(lang, 'policyAccepted')}\n\n` +
        `${t(lang, 'ifCorrectCreate')}`,
      { reply_markup: registerConfirmKeyboard(lang) }
    );
    return true;
  }

  if (flow.type === 'support_message') {
    if (text.length < 2) {
      await sendMessage(message.chat.id, t(lang, 'supportAsk'), { reply_markup: cancelKeyboard(lang) });
      return true;
    }
    await sendSupportRequest(message.chat.id, flow.user || message.from, text);
    chatFlows.delete(chatId);
    return true;
  }

  if (flow.type === 'deposit_amount') {
    const amount = parseInt(text, 10);
    if (!Number.isFinite(amount) || amount < 10) {
      await sendMessage(message.chat.id, t(lang, 'chooseDepositValid'), { reply_markup: depositAmountKeyboard(lang) });
      return true;
    }
    await setDepositAmount(message.chat.id, flow.account, amount);
    return true;
  }

  if (flow.type === 'deposit_phone') {
    const payerPhone = cleanPhone(text);
    if (!payerPhone) {
      await sendMessage(message.chat.id, `${t(lang, 'pleaseDepositPhone')}\n\n${t(lang, 'examplePhone')}`, { reply_markup: cancelKeyboard(lang) });
      return true;
    }
    await handleDeposit(message, ['/deposit', String(flow.amount), payerPhone]);
    chatFlows.delete(chatId);
    return true;
  }

  if (flow.type === 'withdraw_amount') {
    const amount = parseInt(text, 10);
    if (!Number.isFinite(amount) || amount < 50) {
      await sendMessage(message.chat.id, t(lang, 'chooseWithdrawValid'), { reply_markup: withdrawAmountKeyboard(lang) });
      return true;
    }
    await setWithdrawAmount(message.chat.id, flow.account, amount);
    return true;
  }

  if (flow.type === 'withdraw_phone') {
    const payoutPhone = cleanPhone(text);
    if (!payoutPhone) {
      await sendMessage(message.chat.id, `${t(lang, 'pleasePayoutPhone')}\n\n${t(lang, 'examplePhone')}`, { reply_markup: cancelKeyboard(lang) });
      return true;
    }
    chatFlows.set(chatId, { ...flow, type: 'withdraw_pin', payoutPhone });
    await sendMessage(message.chat.id, t(lang, 'sendWithdrawPin'), { reply_markup: cancelKeyboard(lang) });
    return true;
  }

  if (flow.type === 'withdraw_pin') {
    if (!/^\d{4}$/.test(text)) {
      await sendMessage(message.chat.id, t(lang, 'pin4'), { reply_markup: cancelKeyboard(lang) });
      return true;
    }
    chatFlows.set(chatId, { ...flow, type: 'withdraw_confirm', pin: text });
    await sendMessage(
      message.chat.id,
      `🏦 ${t(lang, 'confirmWithdrawText')}\n\n` +
        `${t(lang, 'amountLine', { amount: flow.amount })}\n` +
        `${t(lang, 'payoutPhone', { phone: flow.payoutPhone })}\n\n` +
        `${t(lang, 'ifCorrectWithdraw')}`,
      { reply_markup: withdrawConfirmKeyboard(lang) }
    );
    return true;
  }

  return false;
}

async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }
  const message = update.message;
  if (!message?.chat?.id) return;
  const text = String(message.text || '').trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const parts = text.split(/\s+/);
  const lang = userLang(message.chat.id);

  try {
    if (command === '/start' && parts[1]) {
      const referralCode = normalizeReferralCode(parts[1]);
      if (referralCode) chatReferrals.set(String(message.chat.id), referralCode);
    }
    if (!command.startsWith('/') && await handleFlowMessage(message)) return;

    if (command === '/start' || command === '/help' || command === '/menu') {
      await sendWelcome(message.chat.id, message.from);
    } else if (command === '/cancel') {
      chatFlows.delete(String(message.chat.id));
      await sendMessage(message.chat.id, t(lang, 'cancelled'), { reply_markup: mainMenuKeyboard(lang) });
    } else if (command === '/id') {
      await sendMessage(message.chat.id, t(lang, 'telegramId', { id: message.from?.id }));
    } else if (command === '/register' || command === '/link') {
      await handleRegister(message, parts);
    } else if (command === '/balance') {
      await handleBalance(message);
    } else if (command === '/invite') {
      await sendInvite(message.chat.id);
    } else if (command === '/deposit') {
      await handleDeposit(message, parts);
    } else if (command === '/withdraw') {
      await handleWithdraw(message, parts);
    } else if (command === '/support') {
      await startSupportFlow(message.chat.id, message.from);
    } else if (command === '/how' || command === '/howtoplay' || command === '/rules') {
      await sendMessage(message.chat.id, gameRulesText(lang), { reply_markup: mainMenuKeyboard(lang) });
    } else if (command === '/game') {
      await sendMessage(message.chat.id, isHttpsUrl(WEBAPP_URL) ? t(lang, 'openGame') : `Open: ${WEBAPP_URL}`, { reply_markup: gameKeyboard(lang, message.chat.id) });
    } else if (command === '/login') {
      await sendMessage(message.chat.id, t(lang, 'loginPrompt'), { reply_markup: loginKeyboard(lang, message.chat.id) });
    } else if (command === '/policy' || command === '/policies') {
      await sendPolicies(message.chat.id, mainMenuKeyboard(lang));
    } else if (command === '/logout') {
      await handleLogout(message);
    } else {
      await sendMessage(message.chat.id, t(lang, 'useMenu'));
    }
  } catch (error) {
    await sendMessage(message.chat.id, friendlyError(error, lang), { reply_markup: mainMenuKeyboard(lang) });
  }
}

async function handleCallback(query) {
  const chatId = query.message?.chat?.id;
  if (!chatId) return;
  const data = String(query.data || '');
  const currentLang = () => userLang(chatId);
  await answerCallback(query.id);

  try {
    if (data === 'flow:cancel') {
      chatFlows.delete(String(chatId));
      await sendMessage(chatId, t(currentLang(), 'cancelled'), { reply_markup: mainMenuKeyboard(currentLang()) });
      return;
    }
    if (data === 'menu:help') {
      await sendMessage(chatId, helpText(userLang(chatId)), { reply_markup: mainMenuKeyboard(userLang(chatId)) });
      return;
    }
    if (data === 'menu:howplay') {
      await sendMessage(chatId, gameRulesText(userLang(chatId)), { reply_markup: mainMenuKeyboard(userLang(chatId)) });
      return;
    }
    if (data === 'menu:policies') {
      await sendPolicies(chatId, mainMenuKeyboard(userLang(chatId)));
      return;
    }
    if (data === 'menu:balance') {
      await handleBalance({ chat: { id: chatId }, from: query.from });
      return;
    }
    if (data === 'menu:invite') {
      await sendInvite(chatId);
      return;
    }
    if (data === 'menu:register') {
      await startRegisterFlow(chatId, query.from);
      return;
    }
    if (data === 'menu:support') {
      await startSupportFlow(chatId, query.from);
      return;
    }
    if (data === 'lang:am' || data === 'lang:en') {
      const lang = data.split(':')[1];
      chatLanguages.set(String(chatId), lang);
      await sendMessage(chatId, t(lang, lang === 'am' ? 'langAm' : 'langEn'), { reply_markup: mainMenuKeyboard(lang) });
      return;
    }
    if (data === 'register:age:yes') {
      const prior = chatFlows.get(String(chatId)) || {};
      chatFlows.set(String(chatId), { ...prior, type: 'register_name', ageConfirmed: true, ageConfirmedAt: new Date().toISOString() });
      await sendMessage(chatId, t(currentLang(), 'sendFullName'), { reply_markup: cancelKeyboard(currentLang()) });
      return;
    }
    if (data === 'register:policy') {
      await sendPolicies(chatId, ageKeyboard(userLang(chatId)));
      return;
    }
    if (data === 'register:confirm') {
      const flow = chatFlows.get(String(chatId));
      if (!flow || flow.type !== 'register_confirm') {
        await sendMessage(chatId, t(currentLang(), 'registrationExpired'), { reply_markup: mainMenuKeyboard(currentLang()) });
        return;
      }
      const data = await serverApi('/api/bot/register', {
        method: 'POST',
        body: {
          telegramId: query.from.id,
          chatId,
          username: query.from.username || '',
          firstName: query.from.first_name || '',
          lastName: query.from.last_name || '',
          name: flow.fullName,
          fullName: flow.fullName,
          phone: flow.phone,
          pin: flow.pin,
          ageConfirmed: true,
          policyAccepted: true,
          referralCode: flow.referralCode || chatReferrals.get(String(chatId)) || '',
        },
      });
      chatFlows.delete(String(chatId));
      const lang = currentLang();
      await sendMessage(
        chatId,
        `${t(lang, data.existing ? 'walletLinked' : 'walletCreated')}\n\n` +
          `${t(lang, 'nameLine', { name: data.account.name })}\n` +
          `${t(lang, 'phone', { phone: data.account.phone })}\n` +
          `${t(lang, 'balance', { balance: data.account.balance })}\n\n` +
          `${t(lang, 'chooseFirstDeposit')}`,
        { reply_markup: depositAmountKeyboard(lang) }
      );
      chatFlows.set(String(chatId), { type: 'deposit_amount', account: data.account });
      return;
    }
    if (data === 'menu:deposit') {
      await startDepositFlow(chatId, query.from);
      return;
    }
    if (data === 'menu:withdraw') {
      await startWithdrawFlow(chatId, query.from);
      return;
    }
    if (data.startsWith('withdraw:amount:')) {
      const flow = chatFlows.get(String(chatId));
      const amount = parseInt(data.split(':')[2], 10);
      if (!flow || flow.type !== 'withdraw_amount') {
        await startWithdrawFlow(chatId, query.from);
        return;
      }
      await setWithdrawAmount(chatId, flow.account, amount);
      return;
    }
    if (data === 'withdraw:custom') {
      const flow = chatFlows.get(String(chatId));
      if (!flow || flow.type !== 'withdraw_amount') {
        await startWithdrawFlow(chatId, query.from);
        return;
      }
      await sendMessage(chatId, t(currentLang(), 'chooseWithdrawValid'), { reply_markup: cancelKeyboard(currentLang()) });
      return;
    }
    if (data === 'withdraw:phone:yes') {
      const flow = chatFlows.get(String(chatId));
      if (!flow || flow.type !== 'withdraw_confirm_phone') {
        await sendMessage(chatId, t(currentLang(), 'withdrawExpired'), { reply_markup: mainMenuKeyboard(currentLang()) });
        return;
      }
      const payoutPhone = flow.account?.phone || '';
      chatFlows.set(String(chatId), { ...flow, type: 'withdraw_pin', payoutPhone });
      await sendMessage(chatId, t(currentLang(), 'sendWithdrawPin'), { reply_markup: cancelKeyboard(currentLang()) });
      return;
    }
    if (data === 'withdraw:phone:no') {
      const flow = chatFlows.get(String(chatId));
      if (!flow || flow.type !== 'withdraw_confirm_phone') {
        await sendMessage(chatId, t(currentLang(), 'withdrawExpired'), { reply_markup: mainMenuKeyboard(currentLang()) });
        return;
      }
      chatFlows.set(String(chatId), { ...flow, type: 'withdraw_phone' });
      await sendMessage(chatId, t(currentLang(), 'typePayoutPhone'), { reply_markup: cancelKeyboard(currentLang()) });
      return;
    }
    if (data === 'withdraw:confirm') {
      const flow = chatFlows.get(String(chatId));
      if (!flow || flow.type !== 'withdraw_confirm') {
        await sendMessage(chatId, t(currentLang(), 'withdrawExpired'), { reply_markup: mainMenuKeyboard(currentLang()) });
        return;
      }
      await handleWithdraw({ chat: { id: chatId }, from: query.from }, ['/withdraw', String(flow.amount), flow.pin, flow.payoutPhone]);
      chatFlows.delete(String(chatId));
      return;
    }
    if (data.startsWith('deposit:amount:')) {
      const flow = chatFlows.get(String(chatId));
      const amount = parseInt(data.split(':')[2], 10);
      if (!flow || flow.type !== 'deposit_amount') {
        await startDepositFlow(chatId, query.from);
        return;
      }
      await setDepositAmount(chatId, flow.account, amount);
      return;
    }
    if (data === 'deposit:custom') {
      const flow = chatFlows.get(String(chatId));
      if (!flow || flow.type !== 'deposit_amount') {
        await startDepositFlow(chatId, query.from);
        return;
      }
      await sendMessage(chatId, t(currentLang(), 'chooseDepositValid'), { reply_markup: cancelKeyboard(currentLang()) });
      return;
    }
    if (data === 'deposit:phone:yes') {
      const flow = chatFlows.get(String(chatId));
      if (!flow || flow.type !== 'deposit_confirm_phone') {
        await sendMessage(chatId, t(currentLang(), 'depositExpired'), { reply_markup: mainMenuKeyboard(currentLang()) });
        return;
      }
      await handleDeposit({ chat: { id: chatId }, from: query.from }, ['/deposit', String(flow.amount), flow.account?.defaultDepositPhone || flow.account?.phone || '']);
      chatFlows.delete(String(chatId));
      return;
    }
    if (data === 'deposit:phone:no') {
      const flow = chatFlows.get(String(chatId));
      if (!flow || flow.type !== 'deposit_confirm_phone') {
        await sendMessage(chatId, t(currentLang(), 'depositExpired'), { reply_markup: mainMenuKeyboard(currentLang()) });
        return;
      }
      chatFlows.set(String(chatId), { ...flow, type: 'deposit_phone' });
      await sendMessage(chatId, t(currentLang(), 'typeDepositPhone'), { reply_markup: cancelKeyboard(currentLang()) });
      return;
    }
    if (data === 'menu:logout') {
      await sendMessage(chatId, t(currentLang(), 'logoutConfirm'), { reply_markup: logoutConfirmKeyboard(currentLang()) });
      return;
    }
    if (data === 'logout:confirm') {
      await handleLogout({ chat: { id: chatId }, from: query.from });
      return;
    }
    await sendMessage(chatId, t(currentLang(), 'useMenu'), { reply_markup: mainMenuKeyboard(currentLang()) });
  } catch (error) {
    await sendMessage(chatId, friendlyError(error, currentLang()), { reply_markup: mainMenuKeyboard(currentLang()) });
  }
}

async function setBotCommands() {
  await tg('setMyCommands', {
    commands: [
      { command: 'start', description: 'Welcome and main menu' },
      { command: 'menu', description: 'Show game buttons' },
      { command: 'register', description: 'Create or link wallet' },
      { command: 'balance', description: 'Check wallet balance' },
      { command: 'invite', description: 'Invite friends to HabeshaBingo' },
      { command: 'deposit', description: 'Create deposit request' },
      { command: 'withdraw', description: 'Create withdrawal request' },
      { command: 'howtoplay', description: 'Game rules and prize basics' },
      { command: 'support', description: 'Talk to support' },
      { command: 'game', description: 'Open HabeshaBingo' },
      { command: 'login', description: 'Login to the Mini App' },
      { command: 'policy', description: 'Read player policies' },
      { command: 'id', description: 'Show Telegram ID' },
      { command: 'logout', description: 'Logout and end session' },
    ],
  });
}

async function poll() {
  while (true) {
    try {
      await refreshBotConfig();
      if (!TOKEN) {
        console.error('Telegram bot token is not configured. Set it in Admin or TELEGRAM_BOT_TOKEN.');
        await new Promise(resolve => setTimeout(resolve, 15_000));
        continue;
      }
      if (!BOT_READY) {
        const me = await tg('getMe', {});
        if (me.username) BOT_USERNAME = me.username;
        await tg('deleteWebhook', { drop_pending_updates: false });
        await setBotCommands();
        BOT_READY = true;
        console.log(`Connected to @${me.username}`);
      }
      const updates = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (error) {
      console.error('Telegram bot error:', error.message);
      BOT_READY = false;
      const delay = /not found|unauthorized|invalid token/i.test(error.message) ? 15_000 : 3_000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

if (require.main === module) {
  console.log(`Telegram bot polling. Game URL: ${WEBAPP_URL}. Server API: ${SERVER_API_URL}`);
  poll();
}

module.exports = { contactKeyboard, inviteKeyboard, loginKeyboard, mainMenuKeyboard };
