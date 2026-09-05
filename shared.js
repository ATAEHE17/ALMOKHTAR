/* =========================================================
   Math Center Platform — Shared Core
   Data layer backed by Firebase Realtime Database (see
   firebase.js, which must be loaded before this file). This
   file never touches the Firebase SDK directly — it only
   reads window._mcCache and writes through window._mc.
   ========================================================= */

var DB_KEYS = { SESSION: 'mc_session_v1' }; // session (who's logged in on THIS device) stays local on purpose[cite: 12]

/* ---------------- generic storage helpers (session/theme/lang only) ---------------- */
function mcRead(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
function mcWrite(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

window.getSettings = function () {
  return window._mcCache.settings;
};
window.saveSettings = function (settings) {
  window._mc.set(window._mc.ref(window._mc.db, 'settings'), settings);
};

/* ---------------- students ---------------- */
window.listenToStudents = function (cb) {
  cb(window.getStudents());
  window.onMCUpdate('students', function () { cb(window.getStudents()); });
};
window.getStudents = function () { return window._mcCache.students || []; };

window.saveStudent = function (student) {
  if (!student.id) {
    var newRef = window._mc.push(window._mc.ref(window._mc.db, 'students'));
    student.id = newRef.key;
    student.createdAt = new Date().toISOString();
    student.paid = false;
    window._mc.set(newRef, student);
  } else {
    window._mc.set(window._mc.ref(window._mc.db, 'students/' + student.id), student);
  }
  var cachedStudent = window._mcCache.students.find(function (item) { return item.id === student.id; });
  if (cachedStudent) Object.keys(student).forEach(function (key) { cachedStudent[key] = student[key]; });
  else window._mcCache.students.push(student);
  return student;
};
window.findStudentByPhone = function (phone, classId) {
  var list = window.getStudents();
  return list.find(function (s) {
    return s.phone === phone && (!classId || s.classId === classId);
  }) || null;
};
window.verifyStudentPassword = function (student, password) {
  return !!student && !!password && student.password === password;
};
window.getStudentById = function (id) {
  var list = window.getStudents();
  return list.find(function (s) { return s.id === id; }) || null;
};
window.getDeviceId = function () {
  var key = 'mc_device_id';
  var id = localStorage.getItem(key);
  if (!id) { id = 'device-' + Math.random().toString(36).slice(2) + Date.now(); localStorage.setItem(key, id); }
  return id;
};
window.updateStudentSession = function (studentId, deviceId) {
  return window._mc.update(window._mc.ref(window._mc.db, 'students/' + studentId), { activeSessionId: deviceId, activeSessionAt: Date.now() });
};
window.togglePaid = function (studentId) {
  var list = window.getStudents();
  var s = list.find(function (x) { return x.id === studentId; });
  if (!s) return null;
  var newVal = !s.paid;
  window._mc.update(window._mc.ref(window._mc.db, 'students/' + studentId), { paid: newVal });
  s.paid = newVal; // optimistic local update; the live listener will confirm it
  return s;
};

/* ---------------- attendance ---------------- */
window.getAttendance = function () { return window._mcCache.attendance || []; };

window.markAttendance = function (studentId, status, dateStr, details) {
  var date = dateStr || new Date().toISOString().slice(0, 10);
  var list = window.getAttendance();
  var existing = list.find(function (a) { return a.studentId === studentId && a.date === date; });
  if (existing) {
    window._mc.update(window._mc.ref(window._mc.db, 'attendance/' + existing.id), { status: status, details: details || [] });
    existing.status = status;
    existing.details = details || [];
    return existing;
  }
  var newRef = window._mc.push(window._mc.ref(window._mc.db, 'attendance'));
  var record = { id: newRef.key, studentId: studentId, date: date, status: status, details: details || [] };
  window._mc.set(newRef, record);
  return record;
};

window.getAttendanceForStudent = function (studentId) {
  return window.getAttendance().filter(function (a) { return a.studentId === studentId; })
    .sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
};

window.getAttendanceStats = function (studentId) {
  var records = window.getAttendanceForStudent(studentId);
  var present = records.filter(function (r) { return r.status === 'present'; }).length;
  var absent = records.filter(function (r) { return r.status === 'absent'; }).length;
  var total = present + absent;
  var pct = total ? Math.round((present / total) * 100) : 0;
  return { present: present, absent: absent, total: total, pct: pct };
};

/* ---------------- grades ---------------- */
window.getGrades = function () { return window._mcCache.grades || []; };

window.saveGrade = function (grade) {
  var newRef = window._mc.push(window._mc.ref(window._mc.db, 'grades'));
  grade.id = newRef.key;
  grade.date = grade.date || new Date().toISOString().slice(0, 10);
  grade.createdAt = new Date().toISOString();
  window._mc.set(newRef, grade);
  return grade;
};

window.deleteGrade = function (gradeId) {
  return window._mc.remove(window._mc.ref(window._mc.db, 'grades/' + gradeId));
};

/* ---------------- homework, notes and notifications ---------------- */
function saveCollectionItem(collection, item) {
  var newRef = window._mc.push(window._mc.ref(window._mc.db, collection));
  item.id = newRef.key;
  item.createdAt = new Date().toISOString();
  if (Array.isArray(window._mcCache[collection])) window._mcCache[collection].push(item);
  return window._mc.set(newRef, item).then(function () { return item; });
}
window.getHomework = function () { return window._mcCache.homework || []; };
window.getNotes = function () { return window._mcCache.notes || []; };
window.getNotifications = function (studentId) {
  return (window._mcCache.notifications || []).filter(function (n) { return !n.studentId || n.studentId === studentId; });
};
window.saveHomework = function (item) { return saveCollectionItem('homework', item); };
window.saveNote = function (item) { return saveCollectionItem('notes', item); };
window.saveNotification = function (item) { return saveCollectionItem('notifications', item); };
window.deleteStudent = function (studentId) {
  var db = window._mc.db, ref = window._mc.ref, remove = window._mc.remove;
  var related = {};
  window.getAttendance().forEach(function (a) { if (a.studentId === studentId) related['attendance/' + a.id] = null; });
  window.getGrades().forEach(function (g) { if (g.studentId === studentId) related['grades/' + g.id] = null; });
  window.getNotes().forEach(function (n) { if (n.studentId === studentId) related['notes/' + n.id] = null; });
  window.getNotifications(studentId).forEach(function (n) { if (n.studentId === studentId) related['notifications/' + n.id] = null; });
  var writes = [remove(ref(db, 'students/' + studentId))];
  Object.keys(related).forEach(function (path) { writes.push(remove(ref(db, path))); });
  return Promise.all(writes);
};

window.getGradesForStudent = function (studentId) {
  return window.getGrades().filter(function (g) { return g.studentId === studentId; })
    .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
};

// Overall percentage = total points earned / total points possible across
// every recorded exam (not a simple average of per-exam percentages), which
// is what "النسبة المئوية العامة" (the general/overall percentage) means.
window.getGradeStats = function (studentId) {
  var records = window.getGradesForStudent(studentId);
  var totalScore = 0, totalMax = 0;
  records.forEach(function (r) {
    totalScore += Number(r.score) || 0;
    totalMax += Number(r.maxScore) || 0;
  });
  var pct = totalMax ? Math.round((totalScore / totalMax) * 100) : 0;
  var avgScore = records.length ? Math.round((totalScore / records.length) * 10) / 10 : 0;
  return { count: records.length, totalScore: totalScore, totalMax: totalMax, pct: pct, avgScore: avgScore };
};

/* ---------------- reset / new-cycle ---------------- */
// Wipes students, attendance and grades (keeps platform settings/centers/classes intact)
// so the admin can start a fresh term/year without reconfiguring the platform.
window.resetAllData = function () {
  var db = window._mc.db, ref = window._mc.ref, remove = window._mc.remove;
  return Promise.all([
    remove(ref(db, 'students')),
    remove(ref(db, 'attendance')),
    remove(ref(db, 'grades'))
  ]);
};

/* ---------------- i18n ---------------- */
var MC_DICT = {
  ar: {
    appName: 'سنتر الرياضيات', loginTitle: 'تسجيل الدخول', enterCode: 'من فضلك أدخل الكود',
    codePlaceholder: 'أدخل كود الأدمن أو كود الصف', continueBtn: 'متابعة', invalidCode: 'الكود غير صحيح، حاول مرة أخرى',
    registeredStudent: 'طالب مسجل', newStudent: 'طالب جديد', parentPhone: 'رقم هاتف ولي الأمر',
    searchAccount: 'ابحث عن الحساب', noAccountFound: 'لا يوجد حساب بهذا الرقم في هذا الصف',
    studentName: 'اسم الطالب', chooseCenter: 'اختر السنتر', uploadAvatar: 'رفع صورة شخصية',
    saveAndContinue: 'حفظ ومتابعة', selectedClass: 'الصف الدراسي المختار',
    adminTitle: 'لوحة تحكم الأستاذ', mainSection: 'الرئيسية', prepSection: 'التجهيز', center: 'السنتر', classLevel: 'الصف الدراسي',
    showList: 'عرض القائمة', addStudent: 'إضافة طالب جديد', fullRecord: 'السجل الشامل',
    attendanceTable: 'قائمة الحضور', paid: 'مدفوع', unpaid: 'غير مدفوع', present: 'حاضر', absent: 'غائب',
    noStudentsYet: 'لا يوجد طلاب في هذه المجموعة بعد', filterByName: 'فلترة بالاسم',
    filterByPhone: 'رقم الهاتف', allCenters: 'كل السناتر', allClasses: 'كل الصفوف',
    settings: 'إعدادات المنصة', changeAdminPassword: 'تغيير كلمة مرور الأدمن', changeClassCodes: 'تغيير أكواد الصفوف',
    platformName: 'اسم المنصة', platformLogo: 'شعار المنصة', save: 'حفظ', cancel: 'إلغاء',
    studentPage: 'صفحة الطالب', attendanceRate: 'نسبة الحضور', absenceCount: 'عدد مرات الغياب',
    monthlyRecord: 'سجل الحضور الشهري', mathAssistant: 'مساعد الرياضيات الذكي', askMathQuestion: 'اسأل سؤالاً في الرياضيات...',
    send: 'إرسال', logout: 'خروج', close: 'إغلاق', edit: 'تعديل', delete: 'حذف',
    sessionsCount: 'عدد الحصص', totalSessions: 'إجمالي الحصص',
    whatsappSent: 'تم تسجيل الحالة وفتح واتساب', paidUpdated: 'تم تحديث حالة الدفع',
    settingsSaved: 'تم حفظ الإعدادات', studentSaved: 'تم حفظ بيانات الطالب',
    wrongPassword: 'كلمة المرور غير صحيحة', required: 'هذا الحقل مطلوب',
    months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
    noRecordsYet: 'لا يوجد سجل حضور بعد', backToAdmin: 'رجوع', themeToggle: 'الوضع الليلي/النهاري',
    langToggle: 'EN', adminLogin: 'دخول الأستاذ', chatbotGreeting: 'أهلاً! اسألني أي سؤال في الرياضيات وهساعدك خطوة بخطوة.',
    chatbotThinking: 'بيفكر...', selectCenterFirst: 'اختر السنتر والصف أولاً', totalStudents: 'عدد الطلاب',
    paidCount: 'دفعوا', unpaidCount: 'لم يدفعوا',
    gradesSection: 'الدرجات', addGrade: 'إضافة درجة', selectStudent: 'اختر الطالب', homeworkFileLabel: 'ملف PDF أو صورة', chooseFile: 'اختيار ملف', noFileChosen: 'لم يتم اختيار ملف',
    examName: 'اسم الاختبار', scoreObtained: 'الدرجة المحصلة', scoreOutOf: 'الدرجة الكاملة',
    gradeSaved: 'تم حفظ الدرجة', gradesList: 'سجل الدرجات', noGradesYet: 'لا يوجد درجات مسجلة بعد',
    overallPercentage: 'النسبة المئوية العامة', averageScore: 'متوسط الدرجة', examsCount: 'عدد الاختبارات',
    examDate: 'التاريخ', chooseStudentFirst: 'اختر طالباً أولاً', deleteGradeConfirm: 'هل تريد حذف هذه الدرجة؟',
    gradeDeleted: 'تم حذف الدرجة', tapToToggle: 'اضغط للتبديل', outOf: 'من',
    studentPassword: 'كلمة المرور', createPassword: 'إنشاء كلمة مرور', confirmPassword: 'تأكيد كلمة المرور',
    passwordMismatch: 'كلمتا المرور غير متطابقتين',
    dangerZone: 'منطقة خطرة', resetData: 'تصفير بيانات الطلاب', resetDataDesc: 'حذف كل الطلاب والدرجات وسجل الحضور نهائياً لبدء دورة أو عام دراسي جديد من الصفر (لن يتأثر اسم المنصة أو السناتر أو الصفوف)',
    resetDataConfirm: 'سيتم حذف جميع بيانات الطلاب والحضور والدرجات نهائياً ولا يمكن التراجع عن هذا الإجراء. هل أنت متأكد من المتابعة؟',
    resetDataConfirm2: 'تأكيد أخير: هل تريد فعلاً حذف كل شيء؟ لا يمكن التراجع بعد ذلك.',
    resetDataDone: 'تم تصفير جميع البيانات بنجاح'
  },
  en: {
    appName: 'Math Center', loginTitle: 'Sign in', enterCode: 'Please enter your code',
    codePlaceholder: 'Enter admin code or class code', continueBtn: 'Continue', invalidCode: 'Invalid code, try again',
    registeredStudent: 'Registered student', newStudent: 'New student', parentPhone: "Parent's phone number",
    searchAccount: 'Find my account', noAccountFound: 'No account found with this number in this class',
    studentName: 'Student name', chooseCenter: 'Choose center', uploadAvatar: 'Upload photo',
    saveAndContinue: 'Save & continue', selectedClass: 'Selected class',
    adminTitle: 'Teacher dashboard', mainSection: 'Home', prepSection: 'Setup', center: 'Center', classLevel: 'Class',
    showList: 'Show list', addStudent: 'Add new student', fullRecord: 'Full record',
    attendanceTable: 'Attendance list', paid: 'Paid', unpaid: 'Unpaid', present: 'Present', absent: 'Absent',
    noStudentsYet: 'No students in this group yet', filterByName: 'Filter by name',
    filterByPhone: 'Phone number', allCenters: 'All centers', allClasses: 'All classes',
    settings: 'Platform settings', changeAdminPassword: 'Change admin password', changeClassCodes: 'Change class codes',
    platformName: 'Platform name', platformLogo: 'Platform logo', save: 'Save', cancel: 'Cancel',
    studentPage: 'Student page', attendanceRate: 'Attendance rate', absenceCount: 'Absences',
    monthlyRecord: 'Monthly attendance', mathAssistant: 'Math AI assistant', askMathQuestion: 'Ask a math question...',
    send: 'Send', logout: 'Log out', close: 'Close', edit: 'Edit', delete: 'Delete',
    sessionsCount: 'Sessions', totalSessions: 'Total sessions',
    whatsappSent: 'Status recorded, opening WhatsApp', paidUpdated: 'Payment status updated',
    settingsSaved: 'Settings saved', studentSaved: 'Student saved',
    wrongPassword: 'Incorrect password', required: 'This field is required',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    noRecordsYet: 'No attendance yet', backToAdmin: 'Back', themeToggle: 'Toggle theme',
    langToggle: 'AR', adminLogin: 'Teacher sign in', chatbotGreeting: "Hi! Ask me any math question and I'll walk you through it.",
    chatbotThinking: 'Thinking...', selectCenterFirst: 'Choose a center and class first', totalStudents: 'Students',
    paidCount: 'Paid', unpaidCount: 'Unpaid',
    gradesSection: 'Grades', addGrade: 'Add grade', selectStudent: 'Select student', homeworkFileLabel: 'PDF or image file', chooseFile: 'Choose file', noFileChosen: 'No file selected',
    examName: 'Exam name', scoreObtained: 'Score obtained', scoreOutOf: 'Out of',
    gradeSaved: 'Grade saved', gradesList: 'Grades record', noGradesYet: 'No grades recorded yet',
    overallPercentage: 'Overall percentage', averageScore: 'Average score', examsCount: 'Exams',
    examDate: 'Date', chooseStudentFirst: 'Choose a student first', deleteGradeConfirm: 'Delete this grade?',
    gradeDeleted: 'Grade deleted', tapToToggle: 'Tap to toggle', outOf: 'of',
    studentPassword: 'Password', createPassword: 'Create password', confirmPassword: 'Confirm password',
    passwordMismatch: 'Passwords do not match',
    dangerZone: 'Danger zone', resetData: 'Reset student data', resetDataDesc: 'Permanently deletes all students, grades and attendance records to start a new term/year from scratch (platform name, centers and classes are kept)',
    resetDataConfirm: 'This will permanently delete all students, attendance and grades. This action cannot be undone. Are you sure you want to continue?',
    resetDataConfirm2: 'Final confirmation: do you really want to delete everything? This cannot be undone.',
    resetDataDone: 'All data was reset successfully'
  }
};

window.mcLang = function () { return localStorage.getItem('mc_lang') || 'ar'; };
window.t = function (key) {
  var dict = MC_DICT[window.mcLang()] || MC_DICT.ar;
  return dict[key] !== undefined ? dict[key] : key;
};
window.applyLangDir = function () {
  var lang = window.mcLang();
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
};
window.toggleLang = function () {
  var next = window.mcLang() === 'ar' ? 'en' : 'ar';
  localStorage.setItem('mc_lang', next);
  window.location.reload();
};

/* ---------------- theme ---------------- */
window.applyTheme = function () {
  var theme = localStorage.getItem('mc_theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
};
window.toggleTheme = function () {
  var current = localStorage.getItem('mc_theme') || 'light';
  var next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('mc_theme', next);
  document.documentElement.setAttribute('data-theme', next);
};

/* ---------------- session ---------------- */
window.setSession = function (session) {
  if (!session || (session.role !== 'admin' && session.role !== 'student')) return null;
  var normalized = { role: session.role };
  if (session.role === 'student') {
    if (session.studentId === undefined || session.studentId === null || String(session.studentId).trim() === '') return null;
    normalized.studentId = String(session.studentId);
  }
  mcWrite(DB_KEYS.SESSION, normalized);
  return normalized;
};
window.getSession = function () {
  var session = mcRead(DB_KEYS.SESSION, null);
  if (!session || (session.role !== 'admin' && session.role !== 'student')) return null;
  if (session.role === 'student' && (session.studentId === undefined || session.studentId === null || String(session.studentId).trim() === '')) return null;
  return session.role === 'student'
    ? { role: 'student', studentId: String(session.studentId) }
    : { role: 'admin' };
};
window.clearSession = function () { localStorage.removeItem(DB_KEYS.SESSION); };

window.whenMCReady = function (cb) {
  if (typeof cb !== 'function') return;
  if (typeof window.onMCReady === 'function') window.onMCReady(cb);
  else window.addEventListener('mc-ready', cb, { once: true });
};

/* ---------------- toast ---------------- */
window.mcToast = function (message) {
  var wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(function () {
    el.style.transition = 'opacity .25s ease, transform .25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(function () { el.remove(); }, 250);
  }, 2200);
};

window.openModal = function (id) {
  var modal = document.getElementById(id);
  if (modal) modal.classList.add('open');
};
window.closeModal = function (id) {
  var modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
};

/* Close modal surfaces when the user clicks their backdrop. */
document.addEventListener('click', function (event) {
  var surface = event.target;
  if (surface && (surface.classList.contains('overlay') || surface.classList.contains('chat-overlay')) && event.target === surface) {
    surface.classList.remove('open');
  }
});

/* ---------------- whatsapp helper ---------------- */
window.openWhatsApp = function (phone, message) {
  if (!phone) return;
  var digits = phone.replace(/[^0-9]/g, '');
  // Assume Egyptian local numbers (starting 01x) -> country code 2[cite: 12]
  if (digits.startsWith('0')) digits = '2' + digits;
  var url = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message);
  window.open(url, '_blank');
};

/* ---------------- avatar file -> dataURL ---------------- */
window.fileToDataUrl = function (file, cb) {
  var reader = new FileReader();
  reader.onload = function (e) { cb(e.target.result); };
  reader.readAsDataURL(file);
};

/* ---------------- initials ---------------- */
window.initials = function (name) {
  if (!name) return '?';
  var parts = name.trim().split(/\s+/);
  return (parts[0][0] || '') + (parts[1] ? parts[1][0] : '');
};
