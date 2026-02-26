import React, { useState, useEffect, useMemo } from 'react';
import { 
  Camera, FileText, CheckCircle, XCircle, Users, BarChart2, Calendar, 
  Plus, Trash2, Save, RefreshCw, TrendingUp, UserCheck, ClipboardList, 
  Clock, QrCode, Smartphone, LogIn, LogOut, ChevronRight, Loader, Cloud, WifiOff, AlertCircle, UserPlus, FileBarChart, Filter, Download, Award, Printer, RotateCcw, X, Link as LinkIcon, Copy, PlayCircle, ShieldAlert
} from 'lucide-react';

// --- Firebase SDK 초기화 ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';

// 환경 변수 및 설정
const firebaseConfigStr = typeof __firebase_config !== 'undefined' ? __firebase_config : "{}";
const firebaseConfig = JSON.parse(firebaseConfigStr);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'excel-spec-attendance-v1';

// --- 상수 정의 ---
const TIME_SLOTS = ['오전', '오후', '저녁'];
const DAYS_KR = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const EXCLUDED_WORDS = ['출석', '결석', '지각', '오전', '오후', '저녁', '요일', '명단', '확인', '선생님', '수업', '체크', '이름', '번호'];

export default function App() {
  // --- 상태 관리 ---
  const [user, setUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [classId, setClassId] = useState("");
  const [inputClassId, setInputClassId] = useState("");
  
  const [members, setMembers] = useState([]);
  const [sessions, setSessions] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState({ text: "", type: "" });

  const [activeTab, setActiveTab] = useState('attendance');
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
  const [currentSlot, setCurrentSlot] = useState('오전');
  const [inputText, setInputText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [viewMode, setViewMode] = useState('admin'); 
  const [qrSession, setQrSession] = useState(null); 
  const [reportView, setReportView] = useState('individual');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));

  // 배포 URL 설정
  const [customBaseUrl, setCustomBaseUrl] = useState(() => localStorage.getItem('attendance_base_url') || "");
  const [modal, setModal] = useState({ isOpen: false, type: '', title: '', text: '', action: null });
  const [promptVal, setPromptVal] = useState("");

  const showStatus = (text, type = "info") => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg({ text: "", type: "" }), 4000);
  };

  const copyToClipboard = (text) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showStatus("링크가 복사되었습니다.", "success");
    } catch (err) {
      showStatus("복사 오류", "error");
    }
    document.body.removeChild(textArea);
  };

  useEffect(() => {
    localStorage.setItem('attendance_base_url', customBaseUrl);
  }, [customBaseUrl]);

  // --- 1. 인증 및 URL 파라미터 감지 ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        showStatus("인증 서버 연결 실패", "error");
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currUser) => {
      setUser(currUser);
      setIsLoading(false);
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'member') {
      const day = params.get('day'), slot = params.get('slot'), target = params.get('classId');
      if (day && slot && target) {
        setViewMode('student');
        setClassId(target);
        setQrSession({ day, slot });
        setIsLoggedIn(true);
      }
    }
    return () => unsubscribe();
  }, []);

  // --- 2. 데이터 실시간 동기화 ---
  useEffect(() => {
    if (!user || !classId || !isLoggedIn) return;

    const safeId = classId.replace(/[^a-zA-Z0-9가-힣]/g, '_');
    setIsLoading(true);

    const membersRef = collection(db, 'artifacts', appId, 'public', 'data', `members_${safeId}`);
    const unsubMembers = onSnapshot(membersRef, (snap) => {
      const list = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      setMembers(list.sort((a, b) => a.name.localeCompare(b.name)));
      setIsLoading(false);
    }, (err) => {
      showStatus("동기화 오류", "error");
      setIsLoading(false);
    });

    const sessionsRef = collection(db, 'artifacts', appId, 'public', 'data', `sessions_${safeId}`);
    const unsubSessions = onSnapshot(sessionsRef, (snap) => {
      const data = {};
      snap.docs.forEach(doc => { data[doc.id] = doc.data(); });
      setSessions(data);
    });

    return () => { unsubMembers(); unsubSessions(); };
  }, [user, classId, isLoggedIn]);

  // --- 3. 비즈니스 로직 ---
  const handleLogin = (e) => {
    e.preventDefault();
    if (!inputClassId.trim()) return;
    setClassId(inputClassId.trim());
    setIsLoggedIn(true);
  };

  const addMemberToDB = async (name) => {
    if (!name.trim() || !user) return null;
    const safeId = classId.replace(/[^a-zA-Z0-9가-힣]/g, '_');
    const docId = `m_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newMember = { name: name.trim(), group: '정회원', createdAt: new Date().toISOString() };
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', `members_${safeId}`, docId);
      await setDoc(docRef, newMember);
      return { ...newMember, id: docId };
    } catch (err) { return null; }
  };

  const confirmDeleteMember = (memberId, memberName) => {
    const hasRecord = Object.values(sessions).some(session => 
      session.presentIds && Array.isArray(session.presentIds) && session.presentIds.includes(memberId)
    );

    if (hasRecord) {
      showStatus(`'${memberName}' 회원은 출석 기록이 존재하여 삭제할 수 없습니다.`, "error");
      return;
    }

    setModal({
      isOpen: true,
      type: 'confirm',
      title: '회원 삭제',
      text: `'${memberName}'님을 명부에서 완전히 삭제하시겠습니까?`,
      action: async () => {
        try {
          const safeId = classId.replace(/[^a-zA-Z0-9가-힣]/g, '_');
          const docRef = doc(db, 'artifacts', appId, 'public', 'data', `members_${safeId}`, memberId);
          await deleteDoc(docRef);
          showStatus(`${memberName} 회원이 삭제되었습니다.`, "success");
        } catch (err) { showStatus("삭제 실패", "error"); }
      }
    });
  };

  const updateAttendance = async (date, slot, presentIds) => {
    if (!user) return;
    const safeId = classId.replace(/[^a-zA-Z0-9가-힣]/g, '_');
    const sessionId = `${date}_${slot}`;
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', `sessions_${safeId}`, sessionId), {
        id: sessionId, date, slot, presentIds, updatedAt: new Date().toISOString()
      });
    } catch (err) { showStatus("저장 실패", "error"); }
  };

  const resetCurrentSession = () => {
    const currentPresentCount = (sessions[`${currentDate}_${currentSlot}`]?.presentIds || []).length;
    if (currentPresentCount === 0) {
      showStatus("지울 데이터가 없습니다.", "info");
      return;
    }

    setModal({
      isOpen: true,
      type: 'confirm',
      title: '세션 초기화',
      text: `${currentDate} ${currentSlot} 출석 기록(${currentPresentCount}명)을 모두 삭제하시겠습니까?`,
      action: async () => {
        await updateAttendance(currentDate, currentSlot, []);
        showStatus("기록이 초기화되었습니다.", "success");
      }
    });
  };

  const openSelfRegistrationModal = () => {
    setModal({
      isOpen: true,
      type: 'prompt',
      title: '신규 회원 출석',
      text: '명단에 이름이 없습니다.\n등록하실 성함을 정확히 입력해주세요.',
      action: async (name) => {
        if (!name || name.trim().length < 2) {
           showStatus("정확한 성함을 입력해주세요.", "error");
           return;
        }
        const result = await addMemberToDB(name);
        if (result) {
          const today = new Date().toISOString().split('T')[0];
          const todayKey = `${today}_${qrSession.slot}`;
          const curP = sessions[todayKey]?.presentIds || [];
          await updateAttendance(today, qrSession.slot, [...curP, result.id]);
          showStatus(`${name}님 출석 확인되었습니다.`, "success");
        }
      }
    });
  };

  // 1번 요구사항: 종이 스캔(텍스트 복사) 출석 기능
  const analyzeAndIngest = async () => {
    if (!inputText.trim()) return;
    setIsAnalyzing(true);
    const found = inputText.match(/[가-힣]{2,4}/g) || [];
    const uniqueFound = Array.from(new Set(found)).filter(n => !EXCLUDED_WORDS.includes(n));
    let currentMembers = [...members];
    
    for (const name of uniqueFound) {
      if (!currentMembers.some(m => m.name === name)) {
        const res = await addMemberToDB(name);
        if (res) currentMembers.push(res);
      }
    }

    const normalizedText = inputText.replace(/\s+/g, '');
    const matchedIds = currentMembers.filter(m => normalizedText.includes(m.name)).map(m => m.id);
    const todayKey = `${currentDate}_${currentSlot}`;
    const existingIds = sessions[todayKey]?.presentIds || [];
    await updateAttendance(currentDate, currentSlot, Array.from(new Set([...existingIds, ...matchedIds])));
    
    setIsAnalyzing(false);
    setInputText("");
    showStatus("종이 명단 스캔 데이터 적재 완료", "success");
  };

  const handleSelfCheckIn = async (mId, mName) => {
    const today = new Date().toISOString().split('T')[0];
    const todayKey = `${today}_${qrSession.slot}`;
    const currentP = sessions[todayKey]?.presentIds || [];
    
    if (currentP.includes(mId)) {
        setModal({
          isOpen: true,
          type: 'confirm',
          title: '출석 취소',
          text: '이미 출석되었습니다. 출석을 취소하시겠습니까?',
          action: async () => {
            await updateAttendance(today, qrSession.slot, currentP.filter(id => id !== mId));
            showStatus("출석이 취소되었습니다.", "info");
          }
        });
        return;
    }
    await updateAttendance(today, qrSession.slot, [...currentP, mId]);
    showStatus(`${mName}님 출석 확인 완료!`, "success");
  };

  const getRawLink = (day, slot) => {
    let base = customBaseUrl.trim();
    if (!base) {
      base = window.location.origin + window.location.pathname;
    }
    if (base.endsWith('/')) base = base.slice(0, -1);
    return `${base}?mode=member&classId=${encodeURIComponent(classId)}&day=${encodeURIComponent(day)}&slot=${encodeURIComponent(slot)}`;
  };

  const getQRUrl = (day, slot) => {
    const url = getRawLink(day, slot);
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}`;
  };

  const simulateQRScan = (day, slot) => {
    setQrSession({ day, slot });
    setViewMode('student');
    window.scrollTo(0, 0);
  };

  // --- 5. 기획서 5번 요구사항: 다각도 리포트 엔진 ---
  const individualStats = useMemo(() => {
    const month = selectedMonth;
    const monthlySessions = Object.values(sessions).filter(s => s.date.startsWith(month));
    if (members.length === 0) return [];
    return members.map(m => {
      const attended = monthlySessions.filter(s => (s.presentIds || []).includes(m.id));
      const slotCounts = { 오전: attended.filter(s => s.slot === '오전').length, 오후: attended.filter(s => s.slot === '오후').length, 저녁: attended.filter(s => s.slot === '저녁').length };
      const total = attended.length; // 회원별 월별 출석 횟수
      const rate = monthlySessions.length > 0 ? Math.round((total / monthlySessions.length) * 100) : 0;
      return { ...m, slotCounts, total, rate };
    }).sort((a, b) => b.total - a.total);
  }, [sessions, members, selectedMonth]);

  const dailyStats = useMemo(() => {
    const table = {};
    Object.values(sessions).forEach(s => {
      if (s.date.startsWith(selectedMonth)) {
        if (!table[s.date]) table[s.date] = { 오전: 0, 오후: 0, 저녁: 0, 합계: 0 };
        const c = s.presentIds?.length || 0;
        table[s.date][s.slot] = c;
        table[s.date].합계 += c;
      }
    });
    // 일자별 차수별 출석 현황
    return Object.entries(table).map(([date, c]) => ({ date, ...c })).sort((a, b) => b.date.localeCompare(a.date));
  }, [sessions, selectedMonth]);

  // --- 6. 뷰 렌더링 ---

  if (isLoading && !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans">
        <Loader className="w-10 h-10 animate-spin text-blue-600 mb-2" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 font-sans">
        <div className="bg-white p-8 md:p-10 rounded-[40px] shadow-2xl w-full max-w-md animate-in fade-in zoom-in duration-700">
          <div className="w-14 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl">
            <ClipboardList className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2 text-center tracking-tight">회원 출석 체크 프로그램</h1>
          <p className="text-slate-400 text-xs md:text-sm mb-8 text-center font-medium">관리자 전용 대시보드 로그인</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="text" value={inputClassId} onChange={(e) => setInputClassId(e.target.value)} placeholder="명부(데이터 룸) 이름 입력" className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/20 font-bold text-center text-sm md:text-base transition-all" autoFocus />
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95 text-sm">
              <LogIn className="w-5 h-5" /> 접속하기
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-24 relative overflow-x-hidden">
      
      {/* 범용 모달 (등록, 삭제, 취소) */}
      {modal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[999] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] p-6 md:p-8 max-w-sm w-full shadow-2xl flex flex-col relative">
            <button onClick={() => { setModal({ isOpen: false }); setPromptVal(""); }} className="absolute top-5 right-5 p-2 bg-slate-100 text-slate-400 rounded-full hover:bg-slate-200 transition-colors">
              <X className="w-4 h-4" />
            </button>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-5 ${modal.type === 'confirm' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
              {modal.type === 'confirm' ? <AlertCircle className="w-6 h-6"/> : <UserPlus className="w-6 h-6"/>}
            </div>
            <h3 className="text-lg font-black text-slate-800 mb-2 tracking-tight">{modal.title}</h3>
            <p className="text-slate-500 mb-6 whitespace-pre-wrap font-medium text-xs md:text-sm leading-relaxed">{modal.text}</p>
            
            {modal.type === 'prompt' && (
              <input 
                type="text" 
                maxLength={10}
                placeholder="성함 입력"
                value={promptVal}
                onChange={e => setPromptVal(e.target.value)}
                onKeyDown={e => { if(e.key === 'Enter') { modal.action(promptVal); setModal({ isOpen: false }); setPromptVal(""); } }}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl mb-5 outline-none focus:border-blue-500 font-bold text-sm"
                autoFocus
              />
            )}
            
            <div className="flex gap-2">
              <button onClick={() => { setModal({ isOpen: false }); setPromptVal(""); }} className="flex-1 py-3 bg-slate-100 text-slate-600 font-black text-sm rounded-xl hover:bg-slate-200 transition-colors">
                취소
              </button>
              <button 
                onClick={() => { modal.action(promptVal); setModal({ isOpen: false }); setPromptVal(""); }} 
                className={`flex-1 py-3 text-white font-black text-sm rounded-xl transition-colors shadow-md ${modal.type === 'confirm' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                {modal.type === 'confirm' ? '실행' : '확인'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 상태 토스트 알림 */}
      {statusMsg.text && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-top-4 duration-300 w-11/12 max-w-sm">
          <div className={`px-5 py-3 rounded-2xl shadow-2xl flex items-center justify-center gap-2 text-xs md:text-sm font-black tracking-tight border ${statusMsg.type === 'error' ? 'bg-white border-red-200 text-red-600' : 'bg-slate-900 text-white'}`}>
            {statusMsg.type === 'error' ? <AlertCircle className="w-4 h-4"/> : <CheckCircle className="w-4 h-4 text-green-400"/>}
            <span className="truncate">{statusMsg.text}</span>
          </div>
        </div>
      )}

      {/* 📱 요구사항 7번: 출석자는 앱 없이 QR로 출석 (학생 화면) */}
      {viewMode === 'student' ? (
        <div className="flex flex-col items-center mt-4 px-4">
          <header className="w-full max-w-md bg-blue-600 text-white p-6 rounded-[32px] shadow-xl mb-6 text-center relative overflow-hidden">
            <button onClick={() => setViewMode('admin')} className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors">
               <LogOut className="w-4 h-4 text-white" />
            </button>
            <Smartphone className="w-8 h-8 mx-auto mb-3 opacity-90" />
            <h1 className="text-xl font-black tracking-tight">{qrSession.day} {qrSession.slot}반 출석</h1>
            <p className="text-blue-100 text-xs font-mono mt-1">{new Date().toLocaleDateString()} 출석체크</p>
          </header>
          <div className="w-full max-w-md bg-white rounded-[32px] p-6 shadow-sm border border-blue-100">
            <h2 className="font-black text-slate-800 mb-6 flex items-center gap-2 text-base border-b pb-3"><Users className="w-5 h-5 text-blue-500" /> 본인 성함을 터치하세요</h2>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2 mb-6 custom-scrollbar">
              {members.map(m => {
                const todayKey = `${new Date().toISOString().split('T')[0]}_${qrSession.slot}`;
                const isDone = (sessions[todayKey]?.presentIds || []).includes(m.id);
                return (
                  <button key={m.id} onClick={() => handleSelfCheckIn(m.id, m.name)}
                    className={`w-full p-4 rounded-2xl font-bold flex justify-between items-center transition-all border-2 ${isDone ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-slate-50 border-slate-100 text-slate-700 active:bg-blue-100 active:scale-95'}`}
                  >
                    <span className="text-sm md:text-base">{m.name}</span>
                    {isDone ? <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-1 rounded-md flex items-center gap-1"><CheckCircle className="w-3 h-3"/> 출석완료</span> : <ChevronRight className="w-4 h-4 text-slate-300" />}
                  </button>
                );
              })}
            </div>
            <button onClick={openSelfRegistrationModal} className="w-full py-3 bg-blue-50 text-blue-700 rounded-xl font-black text-sm flex items-center justify-center gap-2 hover:bg-blue-100 transition-all border border-blue-200 border-dashed">
              <UserPlus className="w-4 h-4" /> 명단에 없으신가요?
            </button>
          </div>
        </div>
      ) : (
        // 💻 요구사항 7번: 관리자는 앱으로 관리 (관리자 대시보드)
        <>
          <header className="bg-white border-b border-slate-200 p-4 sticky top-0 z-50 flex justify-between items-center shadow-sm">
            <div className="max-w-7xl mx-auto w-full flex justify-between items-center px-2">
              <div className="flex items-center gap-3">
                <div className="bg-blue-600 text-white p-2 rounded-xl shadow-md"><ClipboardList className="w-4 h-4"/></div>
                <div>
                  <h2 className="text-base font-black tracking-tighter">출석 체크 관리자</h2>
                  <p className="text-[9px] font-black text-slate-400 uppercase flex items-center gap-1">{classId}</p>
                </div>
              </div>
              <button onClick={() => { setClassId(""); setIsLoggedIn(false); }} className="p-2 bg-slate-50 text-slate-400 hover:text-red-500 transition-colors rounded-xl border border-slate-100"><LogOut className="w-4 h-4" /></button>
            </div>
          </header>

          <main className="max-w-7xl mx-auto p-4 md:p-8">
            <div className="flex bg-white rounded-2xl p-1.5 mb-6 gap-1 shadow-sm border border-slate-100 overflow-x-auto no-scrollbar">
              {[
                { id: 'attendance', label: '종이 스캔 / 현황', icon: Camera },
                { id: 'templates', label: 'QR 생성기', icon: QrCode },
                { id: 'report', label: '통계 리포트', icon: FileBarChart },
                { id: 'management', label: '명부 관리', icon: Users }
              ].map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex-1 min-w-[95px] py-3 rounded-xl text-[10px] md:text-xs font-black transition-all flex items-center justify-center gap-1.5 ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                  <tab.icon className="w-3.5 h-3.5" /> {tab.label}
                </button>
              ))}
            </div>

            {/* --- 탭 1: 종이 스캔(텍스트 연동) 및 출석체크 (요구사항 1, 3) --- */}
            {activeTab === 'attendance' && (
              <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4 items-center">
                  <div className="flex items-center gap-3 flex-1 w-full bg-slate-50 p-2 rounded-2xl">
                    <div className="bg-white p-2 rounded-xl text-blue-600 shadow-sm"><Calendar className="w-5 h-5"/></div>
                    <input type="date" value={currentDate} onChange={(e) => setCurrentDate(e.target.value)} className="text-sm md:text-base font-black outline-none bg-transparent flex-1" />
                  </div>
                  <div className="flex bg-slate-100 p-1 rounded-2xl w-full md:w-auto">
                    {TIME_SLOTS.map(slot => (
                      <button key={slot} onClick={() => setCurrentSlot(slot)} className={`flex-1 md:px-6 py-2 rounded-xl text-[11px] md:text-xs font-black transition-all ${currentSlot === slot ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>{slot}반</button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* 요구사항 1번: 입력은 종이를 스캔해서 출석체크 */}
                  <div className="lg:col-span-1 bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col">
                    <h3 className="font-black text-slate-800 mb-4 flex items-center gap-2 text-sm"><FileText className="w-4 h-4 text-blue-500"/> 종이 명단 스캔 붙여넣기</h3>
                    <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="종이를 스캔하여 추출된 텍스트(이름들)를 붙여넣으세요." className="w-full h-40 bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs md:text-sm outline-none focus:ring-2 focus:ring-blue-500/20 mb-4 font-medium leading-relaxed resize-none" />
                    <button onClick={analyzeAndIngest} disabled={!inputText || isAnalyzing} className="w-full py-3 bg-blue-600 text-white font-black text-sm rounded-xl shadow-md hover:bg-blue-700 disabled:bg-slate-200 flex justify-center gap-2 transition-all active:scale-95">
                      {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} 스캔 텍스트로 일괄 출석
                    </button>
                  </div>

                  <div className="lg:col-span-2 bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-slate-100 pb-4 gap-3">
                      <div className="flex items-center gap-3">
                        <h3 className="font-black text-slate-800 flex items-center gap-2 text-sm md:text-base"><Users className="w-5 h-5 text-blue-500"/> {currentSlot}반 출석 현황</h3>
                        <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-md text-[10px] font-black border border-blue-100">출석 {(sessions[`${currentDate}_${currentSlot}`]?.presentIds || []).length} / 전체 {members.length}</span>
                      </div>
                      <button onClick={resetCurrentSession} className="text-[10px] md:text-xs text-red-500 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1 w-full md:w-auto justify-center">
                        <RotateCcw className="w-3 h-3"/> 출석 정보 초기화
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                      {members.map(m => {
                        const sKey = `${currentDate}_${currentSlot}`;
                        const isP = (sessions[sKey]?.presentIds || []).includes(m.id);
                        return (
                          <div key={m.id} onClick={() => {
                            const curP = sessions[sKey]?.presentIds || [];
                            updateAttendance(currentDate, currentSlot, isP ? curP.filter(id => id !== m.id) : [...curP, m.id]);
                          }} className={`relative p-4 rounded-2xl border-2 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all duration-200 group overflow-hidden ${isP ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm hover:border-red-300' : 'border-slate-100 bg-slate-50 text-slate-400 hover:border-blue-200'}`}>
                            {isP ? <CheckCircle className="w-5 h-5"/> : <XCircle className="w-5 h-5 opacity-20"/>}
                            <span className="font-black text-xs md:text-sm">{m.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* --- 탭 2: 요일별 차수별 QR 생성 (요구사항 2) --- */}
            {activeTab === 'templates' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                  <div className="bg-yellow-50 border border-yellow-200 p-5 rounded-2xl flex flex-col sm:flex-row items-start gap-4 shadow-sm print:hidden">
                    <div className="flex-1">
                      <h4 className="text-sm font-black text-yellow-800 mb-1">앱 배포 URL 설정 (스마트폰 접속용)</h4>
                      <p className="text-xs text-yellow-700 mb-3">
                        Vercel 등에 배포된 실제 주소를 입력해야 스마트폰에서 오류 없이 접속됩니다.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2 bg-white p-2 rounded-xl border border-yellow-200">
                        <input type="text" value={customBaseUrl} onChange={(e) => setCustomBaseUrl(e.target.value)} placeholder="예: https://attendance.vercel.app" className="flex-1 bg-transparent border-none text-slate-800 px-2 py-1 text-xs outline-none w-full"/>
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-600 p-6 rounded-3xl text-white shadow-md flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-black mb-1">요일별/차수별 전용 QR 코드</h3>
                      <p className="opacity-80 text-[11px]">요구사항 2번에 따른 21개 QR 세트입니다.</p>
                    </div>
                    <button onClick={() => window.print()} className="bg-white text-blue-600 px-4 py-2 rounded-xl font-black flex items-center gap-2 shadow-md active:scale-95 transition-all text-xs">
                      <Printer className="w-4 h-4"/> 인쇄
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-8">
                    {DAYS_KR.slice(1, 7).concat(DAYS_KR[0]).map(day => (
                      <div key={day} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm print:shadow-none">
                        <h4 className="text-lg font-black mb-6 border-l-4 border-blue-600 pl-4">{day}</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          {TIME_SLOTS.map(slot => (
                            <div key={slot} className="flex flex-col items-center border border-slate-100 p-6 rounded-2xl bg-slate-50 hover:border-blue-200 transition-all relative">
                                <span className="font-black text-[10px] text-slate-500 mb-4 uppercase">{slot}반</span>
                                <div className="bg-white p-3 border border-slate-200 rounded-xl mb-4"><img src={getQRUrl(day, slot)} alt="QR" className="w-28 h-28" /></div>
                                <span className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-[9px] font-black uppercase mb-4">{day.substring(0,1)} / {slot}</span>
                                
                                <button onClick={() => simulateQRScan(day, slot)} className="w-full text-[11px] flex items-center justify-center gap-1.5 py-2.5 bg-blue-100 text-blue-700 hover:bg-blue-600 hover:text-white rounded-xl font-black transition-colors print:hidden">
                                  <PlayCircle className="w-3.5 h-3.5" /> 스캔 시뮬레이터
                                </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
              </div>
            )}

            {/* --- 탭 3: 다각도 통계 리포트 (요구사항 5) --- */}
            {activeTab === 'report' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col sm:flex-row gap-4 justify-between items-center">
                  <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
                      <button onClick={() => setReportView('individual')} className={`flex-1 px-4 py-2.5 rounded-lg text-[11px] font-black transition-all ${reportView === 'individual' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500'}`}>회원별 월별/일별 출석 횟수</button>
                      <button onClick={() => setReportView('daily')} className={`flex-1 px-4 py-2.5 rounded-lg text-[11px] font-black transition-all ${reportView === 'daily' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500'}`}>일자별 차수별 출석 현황</button>
                  </div>
                  <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 w-full sm:w-auto justify-center">
                    <Filter className="w-3.5 h-3.5 text-slate-400 ml-1" />
                    <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="bg-transparent font-black outline-none text-blue-600 px-2 py-1 text-xs" />
                  </div>
                </div>
                
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 overflow-hidden text-xs">
                  <div className="overflow-x-auto">
                    {reportView === 'individual' ? (
                      <table className="w-full text-left whitespace-nowrap">
                        <thead><tr className="text-slate-500 border-b border-slate-200"><th className="pb-4 px-4 font-black">회원 이름</th><th className="pb-4 text-center font-black">오전 출석</th><th className="pb-4 text-center font-black">오후 출석</th><th className="pb-4 text-center font-black">저녁 출석</th><th className="pb-4 text-center font-black text-blue-600">월별 총 횟수</th><th className="pb-4 text-right font-black">참여율</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">{individualStats.map(i => (
                            <tr key={i.id} className="hover:bg-blue-50/50"><td className="py-4 px-4 font-black text-slate-800">{i.name}</td><td className="py-4 text-center text-slate-500">{i.slotCounts.오전}회</td><td className="py-4 text-center text-slate-500">{i.slotCounts.오후}회</td><td className="py-4 text-center text-slate-500">{i.slotCounts.저녁}회</td><td className="py-4 text-center font-black text-blue-600 text-sm">{i.total}회</td><td className="py-4 text-right font-bold text-[10px] text-slate-400">{i.rate}%</td></tr>
                        ))}</tbody>
                      </table>
                    ) : (
                      <table className="w-full text-left whitespace-nowrap">
                        <thead><tr className="text-slate-500 border-b border-slate-200"><th className="pb-4 px-4 font-black">일자</th><th className="pb-4 text-center font-black">오전반 현황</th><th className="pb-4 text-center font-black">오후반 현황</th><th className="pb-4 text-center font-black">저녁반 현황</th><th className="pb-4 text-right font-black text-blue-600">일일 총 출석</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">{dailyStats.map(d => (
                            <tr key={d.date} className="hover:bg-blue-50/50"><td className="py-4 px-4 font-black text-slate-800">{d.date}</td><td className="py-4 text-center font-bold text-slate-600">{d.오전}명</td><td className="py-4 text-center font-bold text-slate-600">{d.오후}명</td><td className="py-4 text-center font-bold text-slate-600">{d.저녁}명</td><td className="py-4 text-right font-black text-blue-600 text-sm">{d.합계}명</td></tr>
                        ))}</tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* --- 탭 4: 출석명부 관리 (요구사항 4) --- */}
            {activeTab === 'management' && (
              <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-200 animate-in fade-in duration-300">
                <h2 className="text-lg md:text-xl font-black mb-6 flex items-center gap-2"><ClipboardList className="w-5 h-5 text-blue-600"/> 출석 명부 등록 및 삭제</h2>
                
                <div className="flex flex-row gap-2 mb-10 bg-slate-50 p-2.5 rounded-2xl border border-slate-200 shadow-inner max-w-sm">
                  <input 
                    id="newMemInputFinal" 
                    type="text" 
                    maxLength={10} 
                    placeholder="신규 등록 (최대 10자)" 
                    className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs md:text-sm font-bold focus:ring-2 focus:ring-blue-500/20 outline-none w-full"
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.currentTarget.value) { addMemberToDB(e.currentTarget.value); e.currentTarget.value = ""; } }} 
                  />
                  <button onClick={() => { const el = document.getElementById('newMemInputFinal'); if (el.value) { addMemberToDB(el.value); el.value = ""; } }}
                    className="bg-blue-600 text-white px-5 py-3 rounded-xl shadow-md font-black text-[11px] md:text-xs whitespace-nowrap active:scale-95 transition-all">
                    회원 등록
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {members.map(m => (
                    <div key={m.id} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl group hover:border-blue-200 shadow-sm transition-all duration-200">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-100 text-blue-600 rounded-xl flex items-center justify-center font-black text-sm">{m.name.substring(0, 1)}</div>
                        <span className="font-black text-slate-800 text-sm">{m.name}</span>
                      </div>
                      <button 
                        onClick={() => confirmDeleteMember(m.id, m.name)} 
                        className="p-2 bg-slate-50 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors rounded-xl opacity-100 sm:opacity-0 group-hover:opacity-100"
                        title="명부에서 삭제"
                      >
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  ))}
                  {members.length === 0 && <div className="col-span-full py-20 text-center text-slate-400 font-bold text-xs">등록된 회원이 없습니다.</div>}
                </div>
              </div>
            )}
          </main>
        </>
      )}
    </div>
  );
}




