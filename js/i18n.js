"use strict";

/* =========================================================================
   WE RUN Coaching — English / Arabic.

   Keys are grouped by where they appear. Arabic is the club's own running
   vocabulary, not a literal translation: إحماء / جري / استشفاء / تهدئة.

   Teko has no Arabic glyphs, so Arabic headings fall back to Cairo — set in
   index.html under [dir="rtl"]. English is untouched.
   ========================================================================= */

const STRINGS = {
  en: {
    dir: "ltr",
    /* chrome */
    coaching: "Coaching",
    newSession: "New session",
    langLabel: "العربية",
    themeLight: "Light mode",
    themeDark: "Dark mode",

    /* builder */
    buildTitle: "This week's session",
    buildLead: "Build it once, send one link. Anyone who opens it can get it onto a Garmin, COROS or Apple Watch.",
    sessions: "Standing sessions",
    sMonday: "Monday",
    sThursday: "Thursday",
    swapWarn: "Replace what you have built with the standing {day} session?",
    fName: "Session name",
    fNamePh: "Monday | WeRUN",
    fDate: "Date (optional)",
    fCoach: "Coach / club (optional)",
    fCoachPh: "Coach Ahmed",
    fNote: "Note to the group (optional)",
    fNotePh: "Meet 6:30pm at the track. Bring water.",
    fUnits: "Pace units",
    unitKm: "min / km",
    unitMi: "min / mi",
    steps: "Steps",
    addStep: "Add step",
    addRepeat: "Add repeat set",
    yourLink: "Your shareable link",
    linkLead: "The session is encoded in the link itself — nothing is uploaded, and old links keep working forever.",
    copyLink: "Copy link",
    previewIt: "Preview it",
    chars: "characters",
    linkCopied: "Link copied — paste it in the group",
    hard: "hard",
    stepsCount: "steps",
    connectFooterOn: "Athletes who connect once get every future session with a single tap.",
    connectFooterOff: "One-tap delivery is switched off — see the README to turn it on.",

    /* step editor */
    eType: "Type",
    eEnds: "Ends on",
    eDistance: "Distance",
    eTime: "Time",
    eLap: "Lap button",
    eMetres: "Metres",
    eEstLength: "Est. length",
    eLength: "Length",
    eTarget: "Target",
    eNoTarget: "No target",
    ePace: "Pace",
    eHr: "Heart rate",
    eFastest: "Fastest /",
    eSlowest: "Slowest /",
    eLowBpm: "Low bpm",
    eHighBpm: "High bpm",
    eStepName: "Step name",
    eNote: "Note",
    eNotePh: "ABC drills, @mile pace…",
    eRepeat: "Repeat",
    eTimes: "times",
    eStepInside: "+ step inside",
    eUp: "Move up",
    eDown: "Move down",
    eRemove: "Remove",

    /* viewer */
    getItOn: "Get it on your watch",
    garmin: "Garmin",
    garminSub: "Forerunner, Fenix, Venu…",
    coros: "COROS",
    corosSub: "PACE, APEX, VERTIX",
    apple: "Apple Watch",
    appleSub: "watchOS 9 or newer",
    pressLap: "Press lap to continue",
    noTargetEasy: "No target — easy",
    targetIs: "Target ",
    repeatX: "× repeat",
    setBy: "Set by ",
    shareSession: "Share this session",
    footerBuild: "build your own session",
    sessionCopied: "Session copied",
    nameCopied: "Name copied",
    copy: "copy",

    /* pace calculator */
    pcOpen: "Pace calculator",
    pcMile: "Best mile",
    pcFiveK: "Best 5K",
    pcMileLabel: "Your best mile time — spin it",
    pcFiveKLabel: "Your best 5K time — spin it",
    pcMinutes: "Minutes",
    pcSeconds: "Seconds",
    pcExtended: "Past the printed chart — these carry on from its trend.",
    pcThatIs5k: "About a {time} 5K.",
    pcThatIsMile: "About a {time} mile.",
    pcFoot: "From the WE RUN pace chart — use these for the run steps below.",
    pc5k: "5K",
    pc10k: "10K",
    pcTempo: "Tempo",
    pcHm: "Half",
    pcMar: "Marathon",
    pcRec: "Recovery",

    /* routes */
    rTypeIn: "Type it into Garmin Connect",
    rTypeInSub: "About a minute — every number is worked out below",
    rTypeInLead: "Garmin can't import a workout from a link, so this one is typed in. Nothing to work out — just copy the rows.",
    rUsb: "Copy a file over USB",
    rUsbSub: "No typing, but you need a computer and the cable",
    rUsbLead: "Garmin Connect itself can't import workout files — this puts one straight on the watch instead.",
    rApple: "Build it in the Workout app",
    rAppleSub: "watchOS 9 or newer — it saves, so you only do this once",
    rAppleWarn: "Apple has no way to send a workout to a watch from the web — not from us, not from anyone. The Workout app builds custom sessions on the watch itself, so this one is tapped in once.",
    rAppleImport: "Or use an app that imports",
    rAppleImportSub: "WorkOutDoors and similar read the file below",
    rCoros: "Build it in the COROS app",
    rCorosSub: "A minute on the phone — it syncs to the watch on its own",
    rCorosWarn: "COROS can't import a workout from a link either. The builder in the COROS app saves it to your account, so it's typed once and the watch picks it up at the next sync.",
    rCorosTp: "Or come through TrainingPeaks",
    rCorosTpSub: "Worth it if you already use one",
    rText: "Just the text",
    rTextSub: "For your notes or the group chat",
    copySessionText: "Copy session text",
    download: "Download",

    /* connect */
    cTitle: "Send it to my watch",
    cSub: "One tap, no typing — after you approve it once",
    cConnect: "Connect my watch",
    cChecking: "Checking your connection…",
    cConnectedAs: "Connected as ",
    cYourAccount: "your intervals.icu account",
    cPutItOn: "Put it on",
    cSend: "Send to my watch",
    cSending: "Sending…",
    cTryAgain: "Try again",
    cSendAgain: "Send again / pick another day",
    cDisconnect: "Not me — disconnect",
    cSentToast: "Session sent to your watch",
    cLinkedToast: "Connected — you can send it to your watch now",
    cExpired: "Your link to intervals.icu expired — tap Connect again.",

    /* errors */
    brokenTitle: "That link looks broken",
    brokenLead: "The session couldn't be read. Ask your coach to send it again — chat apps sometimes cut long links in half.",
    brokenCta: "Build a session instead",
    copied: "Copied",
    fitFailed: "Could not build the file",
    downloaded: "Downloaded ",

    /* instructions — ** ** marks bold, {x} is filled in by t() */
    gcStep1: "Open **Garmin Connect** → **More** → **Training & Planning** → **Workouts**",
    gcStep2: "**Create a Workout** → **Run**",
    gcStep3: "Name it",
    gcStep4: "Add these steps:",
    gcLap: "For a **lap button** step pick “Lap Button Press” as the end condition — the ~time is only Garmin's estimate and won't stop the step.",
    gcSave: "Save it, then hit **Send to Device** (or just sync). On the watch: **Run → Training → Workouts**.",
    gcRepeat: "Repeat",
    gcTimes: "times",
    gcContaining: ", containing:",
    gcDistance: "Distance ",
    gcDuration: "Duration ",
    gcTargetWord: ", target ",
    gcNoteWord: ", note ",
    usb1: "Plug the watch into a computer with its cable.",
    usb2: "Open the **GARMIN** drive → **GARMIN** folder → **NewFiles** (create it if it isn't there).",
    usb3: "Copy the file into it, then eject and unplug.",
    usb4: "On the watch: **Run → Training → Workouts**.",
    ap1: "On the watch open **Workout** → the **•••** on **Outdoor Run**",
    ap2: "**Create Workout** → **Custom**",
    ap3: "Add a warm-up, then **Add Interval Block** for the reps, then the cool-down.",
    ap4: "The numbers:",
    apPace: "Pace targets go in as **Pace** goals on each work step. Recoveries are **Time** goals.",
    apImportLead: "If you'd rather not tap it out, apps like **WorkOutDoors** or **Intervals.icu** take a structured workout on iPhone and run it on the watch.",
    co1: "In the **COROS** app open **Workout** → **+** → **Create Workout**",
    co2: "Name it",
    co3: "Add a warm-up, then a **Repeat** block for the reps, then the cool-down.",
    co4: "The numbers:",
    coPace: "Each work step takes a **Pace** target; recoveries are **Time**. Save it and the watch pulls it in at the next sync — on the watch: **Run → Workout**.",
    coTpLead: "COROS has an official **TrainingPeaks** integration that pushes structured workouts to the watch. If you already use TrainingPeaks, build it there and skip the typing.",
    cWhy: "Garmin has no way to accept a workout from a link directly, so **intervals.icu** does it for us — it's free, it's an official Garmin partner, and it uploads planned sessions into Garmin Connect for you.",
    cStep1: "Tap the button — intervals.icu asks you to approve **{club}**.",
    cStep2: "Over there, link your Garmin account once and tick **Upload planned workouts**.",
    cStep3: "Come back here and every future session is one tap.",
    cPrivacy: "You approve this on intervals.icu's own page. **{club}** never sees your Garmin or intervals.icu password, and can only add sessions to your calendar.",
    cSentMsg: "Sent — it's on your calendar for {date}.",
    cSentHow: "It reaches Garmin Connect within a few minutes. Open Garmin Connect (or wait for the watch to sync) and you'll find it under **Training** on the day. On the watch: **Run → Training → Workouts**.",
    cGarminOffPre: "Connected, but Garmin upload is off. Open ",
    cGarminOffLink: "intervals.icu settings",
    cGarminOffPost: " and tick “Upload planned workouts”, or the session will sit on the calendar only.",

    /* units */
    uSec: " sec",
    uMin: " min",
    uHour: "h ",
    uM: " m",
    uKm: " km",
    uMi: " mi",
    uBpm: " bpm",
    txtAbout: "About ",
    txtHard: " of it hard",
    uLap: "lap button",
    uLapEst: "lap button, ~",
  },

  ar: {
    dir: "rtl",
    // The wordmark reads the same in both languages — it is part of the logo lockup.
    coaching: "Coaching",
    newSession: "جلسة جديدة",
    langLabel: "English",
    themeLight: "الوضع الفاتح",
    themeDark: "الوضع الداكن",

    buildTitle: "جلسة هذا الأسبوع",
    buildLead: "ابنِها مرة واحدة وأرسل رابطًا واحدًا. من يفتحه ينقلها إلى ساعة جارمن أو كوروس أو آبل.",
    sessions: "الجلسات الثابتة",
    sMonday: "الاثنين",
    sThursday: "الخميس",
    swapWarn: "هل تريد استبدال ما بنيته بجلسة {day} الثابتة؟",
    fName: "اسم الجلسة",
    fNamePh: "الاثنين | WeRUN",
    fDate: "التاريخ (اختياري)",
    fCoach: "المدرب / النادي (اختياري)",
    fCoachPh: "الكابتن أحمد",
    fNote: "ملاحظة للمجموعة (اختياري)",
    fNotePh: "التجمع ٦:٣٠ مساءً عند المضمار. أحضر الماء.",
    fUnits: "وحدة البيس",
    unitKm: "د / كم",
    unitMi: "د / ميل",
    steps: "الخطوات",
    addStep: "إضافة خطوة",
    addRepeat: "إضافة مجموعة تكرار",
    yourLink: "رابط المشاركة",
    linkLead: "الجلسة مُشفَّرة داخل الرابط نفسه — لا يُرفع شيء، والروابط القديمة تبقى تعمل دائمًا.",
    copyLink: "نسخ الرابط",
    previewIt: "معاينة",
    chars: "حرف",
    linkCopied: "تم نسخ الرابط — الصقه في المجموعة",
    hard: "سريع",
    stepsCount: "خطوة",
    connectFooterOn: "من يربط ساعته مرة واحدة تصله كل جلسة قادمة بضغطة واحدة.",
    connectFooterOff: "الإرسال المباشر غير مفعّل — راجع ملف README لتفعيله.",

    eType: "النوع",
    eEnds: "ينتهي عند",
    eDistance: "مسافة",
    eTime: "وقت",
    eLap: "زر اللفة",
    eMetres: "متر",
    eEstLength: "الطول التقديري",
    eLength: "الطول",
    eTarget: "الهدف",
    eNoTarget: "بدون هدف",
    ePace: "بيس",
    eHr: "نبض القلب",
    eFastest: "الأسرع /",
    eSlowest: "الأبطأ /",
    eLowBpm: "أدنى نبضة",
    eHighBpm: "أعلى نبضة",
    eStepName: "اسم الخطوة",
    eNote: "ملاحظة",
    eNotePh: "تمارين ABC، بيس الميل…",
    eRepeat: "تكرار",
    eTimes: "مرات",
    eStepInside: "+ خطوة بالداخل",
    eUp: "لأعلى",
    eDown: "لأسفل",
    eRemove: "حذف",

    getItOn: "انقلها إلى ساعتك",
    garmin: "جارمن",
    garminSub: "Forerunner، Fenix، Venu…",
    coros: "كوروس",
    corosSub: "PACE، APEX، VERTIX",
    apple: "آبل ووتش",
    appleSub: "watchOS 9 أو أحدث",
    pressLap: "اضغط زر اللفة للمتابعة",
    noTargetEasy: "بدون هدف — هادئ",
    targetIs: "الهدف ",
    repeatX: "× تكرار",
    setBy: "بإشراف ",
    shareSession: "شارك الجلسة",
    footerBuild: "ابنِ جلستك",
    sessionCopied: "تم نسخ الجلسة",
    nameCopied: "تم نسخ الاسم",
    copy: "نسخ",

    pcOpen: "حاسبة البيس",
    pcMile: "أفضل ميل",
    pcFiveK: "أفضل ٥ كم",
    pcMileLabel: "أفضل زمن لك في الميل — حرّك العجلة",
    pcFiveKLabel: "أفضل زمن لك في ٥ كم — حرّك العجلة",
    pcMinutes: "الدقائق",
    pcSeconds: "الثواني",
    pcExtended: "خارج الجدول المطبوع — هذه امتداد لاتجاهه.",
    pcThatIs5k: "أي ٥ كم في {time} تقريبًا.",
    pcThatIsMile: "أي ميل في {time} تقريبًا.",
    pcFoot: "من جدول بيس WE RUN — استخدمه في خطوات الجري بالأسفل.",
    pc5k: "٥ كم",
    pc10k: "١٠ كم",
    pcTempo: "تيمبو",
    pcHm: "نصف ماراثون",
    pcMar: "ماراثون",
    pcRec: "استشفاء",

    rTypeIn: "أدخلها في تطبيق Garmin Connect",
    rTypeInSub: "دقيقة تقريبًا — كل الأرقام محسوبة بالأسفل",
    rTypeInLead: "جارمن لا يستورد التمرين من رابط، لذلك تُكتب يدويًا. لا حساب عليك — انسخ الصفوف فقط.",
    rUsb: "انسخ ملفًا عبر USB",
    rUsbSub: "بدون كتابة، لكن تحتاج حاسوبًا وكابل الساعة",
    rUsbLead: "تطبيق Garmin Connect نفسه لا يستورد ملفات التمارين — هذه الطريقة تضع الملف في الساعة مباشرة.",
    rApple: "ابنِها في تطبيق Workout",
    rAppleSub: "watchOS 9 أو أحدث — تُحفظ، فتفعلها مرة واحدة فقط",
    rAppleWarn: "آبل لا تتيح إرسال تمرين إلى الساعة من الويب — لا منّا ولا من غيرنا. تطبيق Workout يبني الجلسات على الساعة نفسها، لذلك تُدخل مرة واحدة.",
    rAppleImport: "أو استخدم تطبيقًا يستورد",
    rAppleImportSub: "WorkOutDoors وغيره يقرأ الملف بالأسفل",
    rCoros: "ابنِها في تطبيق COROS",
    rCorosSub: "دقيقة على الهاتف — وتصل إلى الساعة وحدها",
    rCorosWarn: "كوروس أيضًا لا تستورد تمرينًا من رابط. مُنشئ التمارين في تطبيق COROS يحفظها في حسابك، فتُدخل مرة واحدة وتلتقطها الساعة عند المزامنة التالية.",
    rCorosTp: "أو عبر TrainingPeaks",
    rCorosTpSub: "مفيد إن كنت تستخدمه أصلًا",
    rText: "النص فقط",
    rTextSub: "لملاحظاتك أو لمجموعة الواتساب",
    copySessionText: "نسخ نص الجلسة",
    download: "تحميل",

    cTitle: "أرسلها إلى ساعتي",
    cSub: "ضغطة واحدة بلا كتابة — بعد موافقتك مرة واحدة",
    cConnect: "اربط ساعتي",
    cChecking: "جارٍ التحقق من الربط…",
    cConnectedAs: "مرتبط باسم ",
    cYourAccount: "حسابك في intervals.icu",
    cPutItOn: "ضعها في يوم",
    cSend: "أرسلها إلى ساعتي",
    cSending: "جارٍ الإرسال…",
    cTryAgain: "حاول مرة أخرى",
    cSendAgain: "أرسل مرة أخرى / اختر يومًا آخر",
    cDisconnect: "لست أنا — فك الربط",
    cSentToast: "أُرسلت الجلسة إلى ساعتك",
    cLinkedToast: "تم الربط — يمكنك إرسالها إلى ساعتك الآن",
    cExpired: "انتهت صلاحية ربطك بـ intervals.icu — اضغط «اربط ساعتي» مجددًا.",

    brokenTitle: "يبدو أن الرابط تالف",
    brokenLead: "تعذّرت قراءة الجلسة. اطلب من مدربك إرسالها مرة أخرى — تطبيقات المحادثة تقص الروابط الطويلة أحيانًا.",
    brokenCta: "ابنِ جلسة بدلًا من ذلك",
    copied: "تم النسخ",
    fitFailed: "تعذّر إنشاء الملف",
    downloaded: "تم تحميل ",

    gcStep1: "افتح **Garmin Connect** ← **المزيد** ← **التدريب والتخطيط** ← **التمارين**",
    gcStep2: "**إنشاء تمرين** ← **جري**",
    gcStep3: "سمِّه",
    gcStep4: "أضف هذه الخطوات:",
    gcLap: "لخطوة **زر اللفة** اختر «Lap Button Press» كشرط الإنهاء — الوقت التقريبي مجرد تقدير من جارمن ولن يوقف الخطوة.",
    gcSave: "احفظه ثم اضغط **Send to Device** (أو زامن الساعة فقط). على الساعة: **Run ← Training ← Workouts**.",
    gcRepeat: "تكرار",
    gcTimes: "مرات",
    gcContaining: "، وتحتوي:",
    gcDistance: "مسافة ",
    gcDuration: "وقت ",
    gcTargetWord: "، الهدف ",
    gcNoteWord: "، ملاحظة ",
    usb1: "وصّل الساعة بالحاسوب باستخدام الكابل.",
    usb2: "افتح قرص **GARMIN** ← مجلد **GARMIN** ← **NewFiles** (أنشئه إن لم يكن موجودًا).",
    usb3: "انسخ الملف بداخله، ثم أخرج الجهاز وافصله.",
    usb4: "على الساعة: **Run ← Training ← Workouts**.",
    ap1: "على الساعة افتح **Workout** ← علامة **•••** عند **Outdoor Run**",
    ap2: "**Create Workout** ← **Custom**",
    ap3: "أضف الإحماء، ثم **Add Interval Block** للتكرارات، ثم التهدئة.",
    ap4: "الأرقام:",
    apPace: "أهداف البيس تُدخل كـ **Pace** في خطوات الجري. فترات الراحة تكون **Time**.",
    apImportLead: "إن لم ترغب بإدخالها يدويًا، تطبيقات مثل **WorkOutDoors** أو **Intervals.icu** تقرأ التمرين المنظَّم على الآيفون وتشغّله على الساعة.",
    co1: "في تطبيق **COROS** افتح **Workout** ← **+** ← **Create Workout**",
    co2: "سمِّها",
    co3: "أضف الإحماء، ثم كتلة **Repeat** للتكرارات، ثم التهدئة.",
    co4: "الأرقام:",
    coPace: "كل خطوة جري تأخذ هدف **Pace**، وفترات الراحة **Time**. احفظها وتصل الساعة عند المزامنة التالية — على الساعة: **Run ← Workout**.",
    coTpLead: "لدى كوروس تكامل رسمي مع **TrainingPeaks** يرسل التمارين المنظَّمة إلى الساعة. إن كنت تستخدم TrainingPeaks أصلًا، ابنِها هناك ووفّر الكتابة.",
    cWhy: "جارمن لا تقبل تمرينًا من رابط مباشرة، لذلك يقوم **intervals.icu** بذلك نيابةً عنا — مجاني، وشريك رسمي لجارمن، ويرفع الجلسات المخططة إلى Garmin Connect.",
    cStep1: "اضغط الزر — سيطلب منك intervals.icu الموافقة على **{club}**.",
    cStep2: "هناك، اربط حساب جارمن مرة واحدة وفعّل **Upload planned workouts**.",
    cStep3: "ارجع إلى هنا، وكل جلسة قادمة تصلك بضغطة واحدة.",
    cPrivacy: "الموافقة تتم على صفحة intervals.icu نفسها. **{club}** لا يرى كلمة مرور جارمن أو intervals.icu، ولا يمكنه سوى إضافة الجلسات إلى تقويمك.",
    cSentMsg: "تم الإرسال — الجلسة في تقويمك ليوم {date}.",
    cSentHow: "تصل إلى Garmin Connect خلال دقائق. افتح Garmin Connect (أو انتظر مزامنة الساعة) وستجدها تحت **Training** في ذلك اليوم. على الساعة: **Run ← Training ← Workouts**.",
    cGarminOffPre: "تم الربط، لكن الرفع إلى جارمن غير مفعّل. افتح ",
    cGarminOffLink: "إعدادات intervals.icu",
    cGarminOffPost: " وفعّل «Upload planned workouts»، وإلا ستبقى الجلسة في التقويم فقط.",

    uSec: " ثانية",
    uMin: " دقيقة",
    uHour: "س ",
    uM: " م",
    uKm: " كم",
    uMi: " ميل",
    uBpm: " نبضة",
    txtAbout: "حوالي ",
    txtHard: " منها سريع",
    uLap: "زر اللفة",
    uLapEst: "زر اللفة، ~",
  },
};

/** Step vocabulary, kept beside the rest of the coach's language. */
const KIND_LABELS = {
  en: { warmup: "Warm Up", work: "Run", recovery: "Recover", cooldown: "Cool Down", rest: "Rest", other: "Other" },
  ar: { warmup: "إحماء", work: "جري", recovery: "استشفاء", cooldown: "تهدئة", rest: "راحة", other: "أخرى" },
};

const I18N = {
  KEY: "werun.lang",
  lang: "en",

  /** Saved choice, else the browser's, else English. */
  initial() {
    let saved = null;
    try {
      saved = localStorage.getItem(I18N.KEY);
    } catch (e) {}
    if (saved === "ar" || saved === "en") return saved;
    return (navigator.language || "en").toLowerCase().startsWith("ar") ? "ar" : "en";
  },

  apply(lang) {
    I18N.lang = STRINGS[lang] ? lang : "en";
    const root = document.documentElement;
    root.setAttribute("lang", I18N.lang);
    root.setAttribute("dir", STRINGS[I18N.lang].dir);
    try {
      localStorage.setItem(I18N.KEY, I18N.lang);
    } catch (e) {}
  },

  toggle() {
    I18N.apply(I18N.lang === "ar" ? "en" : "ar");
  },
};

/**
 * Look up a string; falls back to English, then to the key itself.
 * `vars` fills `{name}` placeholders.
 */
function t(key, vars) {
  const table = STRINGS[I18N.lang] || STRINGS.en;
  let v = table[key];
  if (v == null) v = STRINGS.en[key];
  if (v == null) return key;
  if (vars) v = v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  return v;
}

/** Localised label for a step type. */
function kindLabel(type) {
  const table = KIND_LABELS[I18N.lang] || KIND_LABELS.en;
  return table[type] || KIND_LABELS.en[type] || type;
}

/* ---------- theme --------------------------------------------------------- */

const Theme = {
  KEY: "werun.theme",

  /** "light" | "dark" | null (follow the device). */
  saved() {
    try {
      const v = localStorage.getItem(Theme.KEY);
      return v === "light" || v === "dark" ? v : null;
    } catch (e) {
      return null;
    }
  },

  /** What the page is actually showing right now. */
  current() {
    return Theme.saved() || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  },

  apply(mode) {
    const root = document.documentElement;
    if (mode) root.setAttribute("data-theme", mode);
    else root.removeAttribute("data-theme");
    try {
      if (mode) localStorage.setItem(Theme.KEY, mode);
      else localStorage.removeItem(Theme.KEY);
    } catch (e) {}
  },

  toggle() {
    Theme.apply(Theme.current() === "dark" ? "light" : "dark");
  },
};
