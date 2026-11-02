// Terms and conditions, in every language of the app. Bump TERMS_VERSION when the meaning changes.
// © Awais Amin
export const TERMS_VERSION = '2026-11';
type Lang = 'en' | 'ur' | 'ar' | 'hi' | 'es';
export const TERMS: Record<Lang, { title: string; accept: string; points: string[] }> = {
  en: { title: 'Terms and conditions', accept: 'I have read and accept these terms', points: [
    'PharmaDesk is commercial software by Awais Amin, licensed per branch. It may not be copied, resold or changed, and the licence check may not be removed.',
    'The software is provided as it is. As far as the law allows, the developer is not responsible for any loss of data, loss of profit or other loss from using it or being unable to use it, including power cuts, device failure, mistakes or software faults.',
    'Your data stays on your own devices. You alone are responsible for keeping regular backups in a safe place.',
    'Medicine lists, prices, interaction warnings and AI answers are only an aid. The pharmacist must check every medicine, dose and expiry date, and is responsible for what is sold.',
    'You are responsible for following the laws that apply to your pharmacy, including tax, drug licence and patient privacy rules.',
    'If a licence is paused, cancelled or ends, the software locks and shop data cannot be viewed in it until a valid key is entered. The owner can still save a backup file.',
    'Free support lasts 1 month from purchase. After that, support and updates may be charged. Some updates must be installed before the software can be used.',
    'When online, the software sends the developer basic licence details, shop name and counts, never patient details. Support access is used only when the owner switches it on.',
  ] },
  ur: { title: 'شرائط و ضوابط', accept: 'میں نے یہ شرائط پڑھ لی ہیں اور قبول کرتا ہوں', points: [
    'فارما ڈیسک اویس امین کا تجارتی سافٹ ویئر ہے جس کا لائسنس ہر برانچ کے لیے الگ ہے۔ اسے کاپی کرنا، آگے بیچنا یا تبدیل کرنا منع ہے اور لائسنس کی جانچ ہٹانا منع ہے۔',
    'سافٹ ویئر جیسا ہے ویسا ہی فراہم کیا جاتا ہے۔ قانون کی حد تک، ڈیولپر ڈیٹا کے ضائع ہونے، منافع کے نقصان یا اس کے استعمال یا استعمال نہ کر پانے سے ہونے والے کسی بھی نقصان کا ذمہ دار نہیں، بشمول بجلی کی بندش، آلے کی خرابی، غلطیوں یا سافٹ ویئر کی خرابیوں کے۔',
    'آپ کا ڈیٹا آپ کے اپنے آلات پر رہتا ہے۔ باقاعدہ بیک اپ محفوظ جگہ پر رکھنا صرف آپ کی ذمہ داری ہے۔',
    'ادویات کی فہرست، قیمتیں، باہمی اثرات کی وارننگ اور اے آئی کے جوابات صرف مدد کے لیے ہیں۔ فارماسسٹ ہر دوا، خوراک اور میعاد خود چیک کرے اور فروخت کا ذمہ دار وہی ہے۔',
    'آپ کی فارمیسی پر لاگو قوانین پر عمل آپ کی ذمہ داری ہے، بشمول ٹیکس، ڈرگ لائسنس اور مریض کی رازداری کے قواعد۔',
    'لائسنس روکے جانے، منسوخ ہونے یا ختم ہونے پر سافٹ ویئر بند ہو جاتا ہے اور درست کی ڈالنے تک دکان کا ڈیٹا اس میں نظر نہیں آتا۔ مالک پھر بھی بیک اپ فائل محفوظ کر سکتا ہے۔',
    'مفت سپورٹ خریداری سے 1 مہینہ ہے۔ اس کے بعد سپورٹ اور اپ ڈیٹس کی فیس ہو سکتی ہے۔ کچھ اپ ڈیٹس انسٹال کیے بغیر سافٹ ویئر استعمال نہیں ہو گا۔',
    'آن لائن ہونے پر سافٹ ویئر ڈیولپر کو لائسنس کی بنیادی معلومات، دکان کا نام اور گنتی بھیجتا ہے، مریض کی معلومات کبھی نہیں۔ سپورٹ رسائی صرف تب استعمال ہوتی ہے جب مالک اسے آن کرے۔',
  ] },
  ar: { title: 'الشروط والأحكام', accept: 'لقد قرأت هذه الشروط وأوافق عليها', points: [
    'فارما ديسك برنامج تجاري من تطوير أويس أمين، مرخص لكل فرع. لا يجوز نسخه أو إعادة بيعه أو تعديله أو إزالة فحص الترخيص منه.',
    'يُقدَّم البرنامج كما هو. وبالقدر الذي يسمح به القانون، لا يتحمل المطور مسؤولية أي فقدان للبيانات أو خسارة للأرباح أو أي خسارة أخرى ناتجة عن استخدامه أو تعذر استخدامه، بما في ذلك انقطاع الكهرباء أو تعطل الأجهزة أو الأخطاء أو أعطال البرنامج.',
    'تبقى بياناتك على أجهزتك. أنت وحدك مسؤول عن حفظ نسخ احتياطية منتظمة في مكان آمن.',
    'قوائم الأدوية والأسعار وتحذيرات التداخلات وإجابات الذكاء الاصطناعي للمساعدة فقط. على الصيدلي التحقق من كل دواء وجرعة وتاريخ انتهاء، وهو المسؤول عما يُباع.',
    'أنت مسؤول عن اتباع القوانين السارية على صيدليتك، بما فيها قواعد الضرائب وترخيص الأدوية وخصوصية المرضى.',
    'عند إيقاف الترخيص أو إلغائه أو انتهائه يُقفل البرنامج ولا يمكن عرض بيانات المتجر فيه حتى إدخال مفتاح صالح. ويظل بإمكان المالك حفظ ملف نسخة احتياطية.',
    'الدعم المجاني لمدة شهر واحد من الشراء. بعد ذلك قد تُفرض رسوم على الدعم والتحديثات. بعض التحديثات يجب تثبيتها قبل استخدام البرنامج.',
    'عند الاتصال بالإنترنت يرسل البرنامج إلى المطور بيانات الترخيص الأساسية واسم المتجر وأعدادًا، ولا يرسل بيانات المرضى أبدًا. لا يُستخدم وصول الدعم إلا عندما يفعّله المالك.',
  ] },
  hi: { title: 'नियम और शर्तें', accept: 'मैंने ये शर्तें पढ़ ली हैं और स्वीकार करता हूँ', points: [
    'फार्माडेस्क अवैस अमीन का व्यावसायिक सॉफ़्टवेयर है, जिसका लाइसेंस हर शाखा के लिए अलग है। इसे कॉपी करना, दोबारा बेचना या बदलना और लाइसेंस जाँच हटाना मना है।',
    'सॉफ़्टवेयर जैसा है वैसा ही दिया जाता है। कानून की सीमा तक, डेवलपर डेटा के नुकसान, लाभ की हानि या इसके उपयोग अथवा उपयोग न कर पाने से हुए किसी भी नुकसान का ज़िम्मेदार नहीं है, जिसमें बिजली जाना, डिवाइस ख़राब होना, ग़लतियाँ या सॉफ़्टवेयर की ख़राबियाँ शामिल हैं।',
    'आपका डेटा आपके अपने डिवाइस पर रहता है। नियमित बैकअप सुरक्षित जगह रखना केवल आपकी ज़िम्मेदारी है।',
    'दवा सूची, क़ीमतें, परस्पर प्रभाव की चेतावनियाँ और एआई के उत्तर केवल सहायता के लिए हैं। फार्मासिस्ट को हर दवा, ख़ुराक और समाप्ति तिथि जाँचनी होगी और बिक्री की ज़िम्मेदारी उसी की है।',
    'आपकी फार्मेसी पर लागू क़ानूनों का पालन आपकी ज़िम्मेदारी है, जिसमें कर, ड्रग लाइसेंस और मरीज़ की निजता के नियम शामिल हैं।',
    'लाइसेंस रोके जाने, रद्द होने या समाप्त होने पर सॉफ़्टवेयर बंद हो जाता है और मान्य की डालने तक दुकान का डेटा इसमें नहीं दिखता। मालिक फिर भी बैकअप फ़ाइल सहेज सकता है।',
    'मुफ़्त सहायता ख़रीद से 1 महीने तक है। उसके बाद सहायता और अपडेट का शुल्क लग सकता है। कुछ अपडेट इंस्टॉल किए बिना सॉफ़्टवेयर उपयोग नहीं होगा।',
    'ऑनलाइन होने पर सॉफ़्टवेयर डेवलपर को लाइसेंस की बुनियादी जानकारी, दुकान का नाम और गिनती भेजता है, मरीज़ की जानकारी कभी नहीं। सहायता पहुँच तभी उपयोग होती है जब मालिक इसे चालू करे।',
  ] },
  es: { title: 'Términos y condiciones', accept: 'He leído y acepto estos términos', points: [
    'PharmaDesk es software comercial de Awais Amin, con licencia por sucursal. No se puede copiar, revender ni modificar, ni se puede eliminar la comprobación de licencia.',
    'El software se ofrece tal como está. En la medida en que lo permita la ley, el desarrollador no es responsable de pérdidas de datos, de beneficios ni de otras pérdidas por usarlo o no poder usarlo, incluidos cortes de luz, fallos del dispositivo, errores o fallos del software.',
    'Sus datos permanecen en sus propios dispositivos. Solo usted es responsable de guardar copias de seguridad periódicas en un lugar seguro.',
    'Las listas de medicamentos, precios, avisos de interacciones y respuestas de IA son solo una ayuda. El farmacéutico debe comprobar cada medicamento, dosis y caducidad, y es responsable de lo que se vende.',
    'Usted es responsable de cumplir las leyes aplicables a su farmacia, incluidas las normas fiscales, de licencia de medicamentos y de privacidad de pacientes.',
    'Si una licencia se pausa, se cancela o termina, el software se bloquea y los datos no se pueden ver en él hasta introducir una clave válida. El propietario aún puede guardar un archivo de copia de seguridad.',
    'El soporte gratuito dura 1 mes desde la compra. Después, el soporte y las actualizaciones pueden tener coste. Algunas actualizaciones deben instalarse para poder usar el software.',
    'Con conexión, el software envía al desarrollador datos básicos de licencia, el nombre de la tienda y recuentos, nunca datos de pacientes. El acceso de soporte solo se usa cuando el propietario lo activa.',
  ] },
};
export const termsFor = (lang: string) => TERMS[(lang in TERMS ? lang : 'en') as Lang];
