// Languages: English, Urdu (اردو), Arabic, Hindi, Spanish. Urdu and Arabic switch
// the whole layout to right-to-left instantly.
export type Lang = 'en' | 'ur' | 'ar' | 'hi' | 'es';
export const LANGS: { code: Lang; label: string; rtl: boolean; font: string }[] = [
  { code: 'en', label: 'English', rtl: false, font: "'Plus Jakarta Sans', system-ui, sans-serif" },
  { code: 'ur', label: 'اردو', rtl: true, font: "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', serif" },
  { code: 'ar', label: 'العربية', rtl: true, font: "'Noto Naskh Arabic', serif" },
  { code: 'hi', label: 'हिन्दी', rtl: false, font: "'Noto Sans Devanagari', 'Plus Jakarta Sans', sans-serif" },
  { code: 'es', label: 'Español', rtl: false, font: "'Plus Jakarta Sans', system-ui, sans-serif" },
];

import { translateText, setPageLanguage } from './phrases.ts';

type Dict = Record<string, string>;
export { en as EN_DICT };

const en: Dict = {
  appName: 'PharmaDesk', dashboard: 'Dashboard', pos: 'Point of Sale', invoices: 'Invoices', inventory: 'Inventory',
  purchases: 'Purchases', suppliers: 'Suppliers', patients: 'Patients', alerts: 'Alerts', reports: 'Reports', ai: 'AI assistant',
  users: 'Users & Access', settings: 'Settings', logout: 'Log out', login: 'Log in', username: 'Username', pin: 'PIN',
  search: 'Search medicine or scan barcode', expiry: 'Expiry', batch: 'Batch', qty: 'Qty', price: 'Price', amount: 'Amount',
  subtotal: 'Subtotal', discount: 'Discount', gst: 'GST', total: 'Total', checkout: 'Checkout & Print', cash: 'Cash',
  card: 'Card / JazzCash', credit: 'Credit (Udhaar)', received: 'Received', change: 'Change', patient: 'Patient',
  emptyBill: 'Scan or search a medicine to start the bill', stock: 'Stock', inStock: 'in stock', online: 'Connected to server',
  offline: 'Server offline — working on this device', syncing: 'Syncing…', pending: 'waiting to sync', save: 'Save', cancel: 'Cancel',
  add: 'Add', delete: 'Delete', edit: 'Edit', close: 'Close', name: 'Name', generic: 'Generic', strength: 'Strength', company: 'Company',
  barcode: 'Barcode', reorderLevel: 'Reorder level', salePrice: 'Sale price', costPrice: 'Cost price', newMedicine: 'New medicine',
  addStock: 'Add stock', receive: 'Receive stock', phone: 'Phone', today: 'Today', sales: 'Sales', profit: 'Profit', bills: 'Bills',
  topSellers: 'Top sellers', needsAttention: 'Needs attention', aiSummary: "Today's AI summary", pairTitle: 'Connect to your shop server',
  pairHelp: 'Scan the QR code on the server PC, then type the 6-digit Server PIN.', scanQr: 'Scan QR', pasteCode: 'Or paste the pairing code',
  serverPin: 'Server PIN', deviceName: 'Name for this device', connect: 'Connect', workingNow: 'Working now', activityLog: 'Activity log',
  addUser: 'Add user', logoutNow: 'Log out now', disable: 'Disable', enable: 'Enable', resetPin: 'Reset PIN', modules: 'Modules', actions: 'Actions',
  owner: 'Owner', role: 'Role', language: 'Language', theme: 'Theme', light: 'Light', dark: 'Dark', system: 'System', shopDetails: 'Shop details',
  geminiKey: 'Gemini API key (free)', readRx: 'Read prescription', rxHelp: 'Type, paste or photograph the prescription', interactions: 'Drug interaction check',
  expired: 'Expired', expiringIn: 'Expires in {n} days', lowStock: 'Low stock', outOfStock: 'Out of stock', noAlerts: 'All good — no alerts',
  stockAdded: 'Stock added! Keep saving lives!', saleDone: 'Sale complete', fefoWarn: 'FEFO: Batch #{b} expires in {n} days — sell this one first!',
  devices: 'Devices', welcome: 'Good to see you', setupOwner: 'Create the owner account', shopName: 'Pharmacy name', confirmDelete: 'Delete this user? Their sales history is kept.',
  supervisorPin: 'Supervisor approval', approve: 'Approve', reprint: 'Reprint', void: 'Void', created: 'Created', by: 'by', all: 'All',
  credits: 'Developed by Awais Amin', about: 'About · Credits',
};

const ur: Dict = {
  appName: 'فارما ڈیسک', dashboard: 'ڈیش بورڈ', pos: 'فوری بلنگ', invoices: 'بل', inventory: 'سٹاک / ادویات', purchases: 'خریداری',
  suppliers: 'سپلائرز', patients: 'مریض', alerts: 'الرٹس', reports: 'رپورٹس', ai: 'اے آئی معاون', users: 'صارفین اور اجازتیں', settings: 'ترتیبات',
  logout: 'لاگ آؤٹ', login: 'لاگ اِن', username: 'یوزر نیم', pin: 'پن', search: 'دوا کا نام یا بارکوڈ', expiry: 'تاریخِ انقضا', batch: 'بیچ',
  qty: 'تعداد', price: 'قیمت', amount: 'رقم', subtotal: 'ذیلی کل', discount: 'رعایت', gst: 'جی ایس ٹی', total: 'کل رقم',
  checkout: 'ادائیگی اور رسید پرنٹ کریں', cash: 'نقد', card: 'کارڈ / جاز کیش', credit: 'ادھار', received: 'وصول', change: 'بقایا', patient: 'مریض',
  emptyBill: 'بل شروع کرنے کے لیے دوا تلاش یا سکین کریں', stock: 'سٹاک', inStock: 'موجود', online: 'سرور سے منسلک',
  offline: 'سرور بند ہے — اسی ڈیوائس پر کام جاری', syncing: 'ہم آہنگی…', pending: 'سنک ہونا باقی', save: 'محفوظ کریں', cancel: 'منسوخ',
  add: 'شامل کریں', delete: 'حذف کریں', edit: 'ترمیم', close: 'بند کریں', name: 'نام', generic: 'جنرک', strength: 'طاقت', company: 'کمپنی',
  barcode: 'بارکوڈ', reorderLevel: 'دوبارہ آرڈر کی حد', salePrice: 'قیمتِ فروخت', costPrice: 'قیمتِ خرید', newMedicine: 'نئی دوا',
  addStock: 'سٹاک شامل کریں', receive: 'سٹاک وصول کریں', phone: 'فون', today: 'آج', sales: 'فروخت', profit: 'منافع', bills: 'بل',
  topSellers: 'سب سے زیادہ بکنے والی', needsAttention: 'توجہ طلب', aiSummary: 'آج کا اے آئی خلاصہ', pairTitle: 'اپنی دکان کے سرور سے جوڑیں',
  pairHelp: 'سرور پی سی پر کیو آر کوڈ سکین کریں، پھر ۶ ہندسوں کا سرور پن لکھیں۔', scanQr: 'کیو آر سکین کریں', pasteCode: 'یا جوڑنے کا کوڈ پیسٹ کریں',
  serverPin: 'سرور پن', deviceName: 'اس ڈیوائس کا نام', connect: 'جوڑیں', workingNow: 'ابھی کام پر', activityLog: 'سرگرمی کا ریکارڈ',
  addUser: 'نیا صارف', logoutNow: 'ابھی لاگ آؤٹ کریں', disable: 'بند کریں', enable: 'چالو کریں', resetPin: 'پن تبدیل کریں', modules: 'ماڈیولز', actions: 'اختیارات',
  owner: 'مالک', role: 'عہدہ', language: 'زبان', theme: 'تھیم', light: 'روشن', dark: 'تاریک', system: 'سسٹم', shopDetails: 'دکان کی تفصیل',
  geminiKey: 'جیمنائی اے پی آئی کی (مفت)', readRx: 'نسخہ پڑھیں', rxHelp: 'نسخہ لکھیں، پیسٹ کریں یا تصویر لیں', interactions: 'ادویات کے باہمی اثرات',
  expired: 'میعاد ختم', expiringIn: '{n} دن میں میعاد ختم', lowStock: 'کم سٹاک', outOfStock: 'سٹاک ختم', noAlerts: 'سب ٹھیک ہے — کوئی الرٹ نہیں',
  stockAdded: 'سٹاک شامل ہو گیا! زندگیاں بچاتے رہیں!', saleDone: 'فروخت مکمل', fefoWarn: 'بیچ #{b} کی تاریخِ انقضا {n} دن میں ہے — پہلے یہی بیچیں!',
  devices: 'ڈیوائسز', welcome: 'خوش آمدید', setupOwner: 'مالک کا اکاؤنٹ بنائیں', shopName: 'فارمیسی کا نام', confirmDelete: 'یہ صارف حذف کریں؟ اس کی فروخت کا ریکارڈ محفوظ رہے گا۔',
  supervisorPin: 'نگران کی منظوری', approve: 'منظور کریں', reprint: 'دوبارہ پرنٹ', void: 'منسوخ بل', created: 'بنایا', by: 'از', all: 'سب',
  credits: 'تیار کردہ: اویس امین', about: 'تعارف · کریڈٹ',
};

const ar: Dict = {
  appName: 'فارما ديسك', dashboard: 'لوحة التحكم', pos: 'نقطة البيع', invoices: 'الفواتير', inventory: 'المخزون', purchases: 'المشتريات',
  suppliers: 'الموردون', patients: 'المرضى', alerts: 'التنبيهات', reports: 'التقارير', ai: 'المساعد الذكي', users: 'المستخدمون والصلاحيات', settings: 'الإعدادات',
  logout: 'تسجيل الخروج', login: 'تسجيل الدخول', username: 'اسم المستخدم', pin: 'الرمز السري', search: 'ابحث عن دواء أو امسح الباركود', expiry: 'تاريخ الانتهاء',
  batch: 'التشغيلة', qty: 'الكمية', price: 'السعر', amount: 'المبلغ', subtotal: 'المجموع الفرعي', discount: 'الخصم', gst: 'ضريبة المبيعات', total: 'الإجمالي',
  checkout: 'الدفع والطباعة', cash: 'نقدًا', card: 'بطاقة / جاز كاش', credit: 'آجل (دين)', received: 'المبلغ المستلم', change: 'الباقي', patient: 'المريض',
  emptyBill: 'ابحث عن دواء أو امسحه لبدء الفاتورة', stock: 'المخزون', inStock: 'متوفر', online: 'متصل بالخادم', offline: 'الخادم غير متصل — العمل مستمر على هذا الجهاز',
  syncing: 'جارٍ المزامنة…', pending: 'بانتظار المزامنة', save: 'حفظ', cancel: 'إلغاء', add: 'إضافة', delete: 'حذف', edit: 'تعديل', close: 'إغلاق', name: 'الاسم',
  generic: 'الاسم العلمي', strength: 'التركيز', company: 'الشركة', barcode: 'الباركود', reorderLevel: 'حد إعادة الطلب', salePrice: 'سعر البيع', costPrice: 'سعر الشراء',
  newMedicine: 'دواء جديد', addStock: 'إضافة مخزون', receive: 'استلام المخزون', phone: 'الهاتف', today: 'اليوم', sales: 'المبيعات', profit: 'الربح', bills: 'الفواتير',
  topSellers: 'الأكثر مبيعًا', needsAttention: 'يحتاج إلى انتباه', aiSummary: 'ملخص اليوم الذكي', pairTitle: 'اتصل بخادم صيدليتك',
  pairHelp: 'امسح رمز QR على جهاز الخادم، ثم اكتب رمز الخادم المكوّن من 6 أرقام.', scanQr: 'مسح رمز QR', pasteCode: 'أو الصق رمز الربط',
  serverPin: 'رمز الخادم', deviceName: 'اسم هذا الجهاز', connect: 'اتصال', workingNow: 'يعمل الآن', activityLog: 'سجل النشاط',
  addUser: 'إضافة مستخدم', logoutNow: 'تسجيل خروجه الآن', disable: 'تعطيل', enable: 'تفعيل', resetPin: 'تغيير الرمز السري', modules: 'الأقسام', actions: 'الصلاحيات',
  owner: 'المالك', role: 'الدور', language: 'اللغة', theme: 'المظهر', light: 'فاتح', dark: 'داكن', system: 'النظام', shopDetails: 'بيانات الصيدلية',
  geminiKey: 'مفتاح Gemini API (مجاني)', readRx: 'قراءة الوصفة', rxHelp: 'اكتب الوصفة أو الصقها أو صوّرها', interactions: 'فحص التداخلات الدوائية',
  expired: 'منتهي الصلاحية', expiringIn: 'ينتهي خلال {n} يومًا', lowStock: 'مخزون منخفض', outOfStock: 'نفد المخزون', noAlerts: 'كل شيء جيد — لا توجد تنبيهات',
  stockAdded: 'تمت إضافة المخزون! استمر في إنقاذ الأرواح!', saleDone: 'تمت عملية البيع', fefoWarn: 'التشغيلة #{b} تنتهي خلال {n} يومًا — بِعها أولاً!',
  devices: 'الأجهزة', welcome: 'سعداء برؤيتك', setupOwner: 'إنشاء حساب المالك', shopName: 'اسم الصيدلية', confirmDelete: 'حذف هذا المستخدم؟ يبقى سجل مبيعاته محفوظًا.',
  supervisorPin: 'موافقة المشرف', approve: 'موافقة', reprint: 'إعادة الطباعة', void: 'إلغاء الفاتورة', created: 'أُنشئ', by: 'بواسطة', all: 'الكل',
  credits: 'تطوير: أويس أمين', about: 'حول · الحقوق',
};

const hi: Dict = {
  appName: 'फार्माडेस्क', dashboard: 'डैशबोर्ड', pos: 'बिलिंग (पॉइंट ऑफ़ सेल)', invoices: 'बिल', inventory: 'स्टॉक / दवाइयाँ', purchases: 'खरीद',
  suppliers: 'सप्लायर', patients: 'मरीज़', alerts: 'अलर्ट', reports: 'रिपोर्ट', ai: 'एआई सहायक', users: 'उपयोगकर्ता और अनुमतियाँ', settings: 'सेटिंग्स',
  logout: 'लॉग आउट', login: 'लॉग इन', username: 'यूज़रनेम', pin: 'पिन', search: 'दवा का नाम या बारकोड', expiry: 'समाप्ति तिथि', batch: 'बैच',
  qty: 'मात्रा', price: 'कीमत', amount: 'राशि', subtotal: 'उप-योग', discount: 'छूट', gst: 'जीएसटी', total: 'कुल',
  checkout: 'भुगतान और प्रिंट', cash: 'नकद', card: 'कार्ड / जैज़कैश', credit: 'उधार', received: 'प्राप्त राशि', change: 'बाकी (वापसी)', patient: 'मरीज़',
  emptyBill: 'बिल शुरू करने के लिए दवा खोजें या स्कैन करें', stock: 'स्टॉक', inStock: 'स्टॉक में', online: 'सर्वर से जुड़ा',
  offline: 'सर्वर बंद — इसी डिवाइस पर काम जारी', syncing: 'सिंक हो रहा है…', pending: 'सिंक होना बाकी', save: 'सेव करें', cancel: 'रद्द करें',
  add: 'जोड़ें', delete: 'हटाएँ', edit: 'बदलें', close: 'बंद करें', name: 'नाम', generic: 'जेनेरिक नाम', strength: 'ताकत', company: 'कंपनी',
  barcode: 'बारकोड', reorderLevel: 'दोबारा ऑर्डर की सीमा', salePrice: 'बिक्री मूल्य', costPrice: 'खरीद मूल्य', newMedicine: 'नई दवा',
  addStock: 'स्टॉक जोड़ें', receive: 'स्टॉक प्राप्त करें', phone: 'फ़ोन', today: 'आज', sales: 'बिक्री', profit: 'मुनाफ़ा', bills: 'बिल',
  topSellers: 'सबसे ज़्यादा बिकने वाली', needsAttention: 'ध्यान दें', aiSummary: 'आज का एआई सारांश', pairTitle: 'अपनी दुकान के सर्वर से जोड़ें',
  pairHelp: 'सर्वर पीसी पर QR कोड स्कैन करें, फिर 6 अंकों का सर्वर पिन लिखें।', scanQr: 'QR स्कैन करें', pasteCode: 'या जोड़ने का कोड पेस्ट करें',
  serverPin: 'सर्वर पिन', deviceName: 'इस डिवाइस का नाम', connect: 'जोड़ें', workingNow: 'अभी काम पर', activityLog: 'गतिविधि लॉग',
  addUser: 'नया उपयोगकर्ता', logoutNow: 'अभी लॉग आउट करें', disable: 'बंद करें', enable: 'चालू करें', resetPin: 'पिन बदलें', modules: 'मॉड्यूल', actions: 'अनुमतियाँ',
  owner: 'मालिक', role: 'भूमिका', language: 'भाषा', theme: 'थीम', light: 'हल्का', dark: 'गहरा', system: 'सिस्टम', shopDetails: 'दुकान का विवरण',
  geminiKey: 'Gemini API कुंजी (मुफ़्त)', readRx: 'पर्चा पढ़ें', rxHelp: 'पर्चा लिखें, पेस्ट करें या फ़ोटो लें', interactions: 'दवाओं की आपसी प्रतिक्रिया जाँच',
  expired: 'समाप्त', expiringIn: '{n} दिन में समाप्त', lowStock: 'कम स्टॉक', outOfStock: 'स्टॉक खत्म', noAlerts: 'सब ठीक है — कोई अलर्ट नहीं',
  stockAdded: 'स्टॉक जोड़ा गया! ज़िंदगियाँ बचाते रहें!', saleDone: 'बिक्री पूरी', fefoWarn: 'बैच #{b} {n} दिन में समाप्त — इसे पहले बेचें!',
  devices: 'डिवाइस', welcome: 'आपका स्वागत है', setupOwner: 'मालिक का खाता बनाएँ', shopName: 'फ़ार्मेसी का नाम', confirmDelete: 'यह उपयोगकर्ता हटाएँ? उसकी बिक्री का रिकॉर्ड सुरक्षित रहेगा।',
  supervisorPin: 'सुपरवाइज़र की मंज़ूरी', approve: 'मंज़ूर करें', reprint: 'दोबारा प्रिंट', void: 'बिल रद्द', created: 'बनाया', by: 'द्वारा', all: 'सभी',
  credits: 'विकसितकर्ता: अवैस अमीन', about: 'परिचय · श्रेय',
};

const es: Dict = {
  appName: 'PharmaDesk', dashboard: 'Panel', pos: 'Punto de venta', invoices: 'Facturas', inventory: 'Inventario', purchases: 'Compras',
  suppliers: 'Proveedores', patients: 'Pacientes', alerts: 'Alertas', reports: 'Informes', ai: 'Asistente IA', users: 'Usuarios y acceso', settings: 'Ajustes',
  logout: 'Cerrar sesión', login: 'Entrar', username: 'Usuario', pin: 'PIN', search: 'Buscar medicamento o escanear código', expiry: 'Caducidad', batch: 'Lote',
  qty: 'Cant.', price: 'Precio', amount: 'Importe', subtotal: 'Subtotal', discount: 'Descuento', gst: 'IVA (GST)', total: 'Total',
  checkout: 'Cobrar e imprimir', cash: 'Efectivo', card: 'Tarjeta / JazzCash', credit: 'Crédito (fiado)', received: 'Recibido', change: 'Cambio', patient: 'Paciente',
  emptyBill: 'Busque o escanee un medicamento para empezar la factura', stock: 'Existencias', inStock: 'en existencia', online: 'Conectado al servidor',
  offline: 'Servidor desconectado — trabajando en este dispositivo', syncing: 'Sincronizando…', pending: 'pendiente de sincronizar', save: 'Guardar', cancel: 'Cancelar',
  add: 'Añadir', delete: 'Eliminar', edit: 'Editar', close: 'Cerrar', name: 'Nombre', generic: 'Genérico', strength: 'Concentración', company: 'Laboratorio',
  barcode: 'Código de barras', reorderLevel: 'Nivel de reposición', salePrice: 'Precio de venta', costPrice: 'Precio de compra', newMedicine: 'Nuevo medicamento',
  addStock: 'Añadir existencias', receive: 'Recibir mercancía', phone: 'Teléfono', today: 'Hoy', sales: 'Ventas', profit: 'Ganancia', bills: 'Facturas',
  topSellers: 'Más vendidos', needsAttention: 'Requiere atención', aiSummary: 'Resumen IA de hoy', pairTitle: 'Conéctese al servidor de su farmacia',
  pairHelp: 'Escanee el código QR en el PC servidor y escriba el PIN de 6 dígitos del servidor.', scanQr: 'Escanear QR', pasteCode: 'O pegue el código de vinculación',
  serverPin: 'PIN del servidor', deviceName: 'Nombre de este dispositivo', connect: 'Conectar', workingNow: 'Trabajando ahora', activityLog: 'Registro de actividad',
  addUser: 'Añadir usuario', logoutNow: 'Cerrar su sesión ahora', disable: 'Desactivar', enable: 'Activar', resetPin: 'Cambiar PIN', modules: 'Módulos', actions: 'Permisos',
  owner: 'Propietario', role: 'Rol', language: 'Idioma', theme: 'Tema', light: 'Claro', dark: 'Oscuro', system: 'Sistema', shopDetails: 'Datos de la farmacia',
  geminiKey: 'Clave de API de Gemini (gratis)', readRx: 'Leer receta', rxHelp: 'Escriba, pegue o fotografíe la receta', interactions: 'Comprobación de interacciones',
  expired: 'Caducado', expiringIn: 'Caduca en {n} días', lowStock: 'Stock bajo', outOfStock: 'Agotado', noAlerts: 'Todo bien — sin alertas',
  stockAdded: '¡Existencias añadidas! ¡Sigue salvando vidas!', saleDone: 'Venta completada', fefoWarn: '¡El lote #{b} caduca en {n} días — véndalo primero!',
  devices: 'Dispositivos', welcome: 'Qué bueno verle', setupOwner: 'Crear la cuenta del propietario', shopName: 'Nombre de la farmacia', confirmDelete: '¿Eliminar este usuario? Su historial de ventas se conserva.',
  supervisorPin: 'Aprobación del supervisor', approve: 'Aprobar', reprint: 'Reimprimir', void: 'Anular', created: 'Creado', by: 'por', all: 'Todos',
  credits: 'Desarrollado por Awais Amin', about: 'Acerca de · Créditos',
};

export const DICTS: Record<Lang, Dict> = { en, ur, ar, hi, es };

export function translate(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const s = DICTS[lang]?.[key] ?? translateText(lang, en[key] ?? key);
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export const isRtl = (lang: Lang) => LANGS.find(l => l.code === lang)?.rtl ?? false;

/** Applies direction, language and font to the whole page at once. */
export function applyLang(lang: Lang, doc: Document = document) {
  const info = LANGS.find(l => l.code === lang) || LANGS[0];
  doc.documentElement.lang = lang;
  doc.documentElement.dir = info.rtl ? 'rtl' : 'ltr';
  doc.documentElement.style.setProperty('--font', info.font);
  setPageLanguage(info.code, doc);
}

/** Money with Rs and local digits grouping (12,34,567 style for Urdu/Hindi). */
export function money(paisa: number, lang: Lang, currency = 'Rs') {
  const v = (paisa || 0) / 100;
  const locale = lang === 'ur' ? 'ur-PK' : lang === 'hi' ? 'en-IN' : lang === 'ar' ? 'ar-AE' : 'en-PK';
  const n = v.toLocaleString(locale === 'ar-AE' ? 'en-PK' : locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${n}`;
}
