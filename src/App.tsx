import React, { useState, useEffect, useRef } from 'react';
import { 
  Phone, 
  History, 
  Users, 
  Settings, 
  Plus, 
  Search, 
  Mic, 
  MicOff, 
  X, 
  Check, 
  MoreVertical, 
  ArrowLeft,
  LogOut,
  Bot,
  Play,
  Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  collection
} from './firebase';
import { 
  onSnapshot, 
  doc, 
  setDoc, 
  addDoc, 
  query, 
  orderBy, 
  deleteDoc,
  Timestamp,
  serverTimestamp
} from 'firebase/firestore';
import { Contact, CallRecord, AITask, OperationType } from './types';
import { handleFirestoreError } from './errorUtils';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GeminiVoiceAssistant } from './services/geminiService';

// --- Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false }: any) => {
  const variants: any = {
    primary: 'bg-black text-white hover:bg-zinc-800',
    secondary: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    outline: 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50'
  };
  
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

const Card = ({ children, className = '' }: any) => (
  <div className={`bg-white rounded-2xl shadow-sm border border-zinc-100 p-4 ${className}`}>
    {children}
  </div>
);

// --- Main App ---

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'calls' | 'contacts' | 'tasks'>('calls');
  
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [tasks, setTasks] = useState<AITask[]>([]);
  
  const [isCalling, setIsCalling] = useState(false);
  const [currentCall, setCurrentCall] = useState<{ contact?: Contact, task?: AITask } | null>(null);
  const [isAiActive, setIsAiActive] = useState(false);
  const [transcription, setTranscription] = useState<string[]>([]);
  const assistantRef = useRef<GeminiVoiceAssistant | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // AI Assistant Logic
  useEffect(() => {
    if (isAiActive && isCalling) {
      const startAssistant = async () => {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return;

        assistantRef.current = new GeminiVoiceAssistant(apiKey);
        const instructions = currentCall?.task?.instructions || "You are a helpful voice assistant on a phone call. Be concise and natural.";
        
        await assistantRef.current.connect(instructions, (text, audio) => {
          if (text) setTranscription(prev => [...prev, `AI: ${text}`]);
          if (audio) playAudio(audio);
        });

        startAudioCapture();
      };
      startAssistant();
    } else {
      stopAudioCapture();
      assistantRef.current?.disconnect();
      assistantRef.current = null;
    }
  }, [isAiActive, isCalling]);

  const startAudioCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 PCM
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        
        // Convert to Base64 and send to Gemini
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
        assistantRef.current?.sendAudio(base64);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      console.error("Audio capture failed:", err);
    }
  };

  const stopAudioCapture = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    processorRef.current?.disconnect();
    audioContextRef.current?.close();
    streamRef.current = null;
    processorRef.current = null;
    audioContextRef.current = null;
  };

  const playAudio = (base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContext.decodeAudioData(bytes.buffer.slice(0), (buffer) => {
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start();
    });
  };
  
  const [showAddContact, setShowAddContact] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);

  // Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        // Sync user profile
        const userRef = doc(db, 'users', u.uid);
        setDoc(userRef, {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          photoURL: u.photoURL
        }, { merge: true }).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${u.uid}`));
      }
    });
    return unsubscribe;
  }, []);

  // Data Sync
  useEffect(() => {
    if (!user) return;

    const qContacts = collection(db, `users/${user.uid}/contacts`);
    const unsubContacts = onSnapshot(qContacts, (snap) => {
      setContacts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Contact)));
    }, (e) => handleFirestoreError(e, OperationType.LIST, `users/${user.uid}/contacts`));

    const qCalls = query(collection(db, `users/${user.uid}/calls`), orderBy('timestamp', 'desc'));
    const unsubCalls = onSnapshot(qCalls, (snap) => {
      setCalls(snap.docs.map(d => ({ id: d.id, ...d.data() } as CallRecord)));
    }, (e) => handleFirestoreError(e, OperationType.LIST, `users/${user.uid}/calls`));

    const qTasks = collection(db, `users/${user.uid}/tasks`);
    const unsubTasks = onSnapshot(qTasks, (snap) => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as AITask)));
    }, (e) => handleFirestoreError(e, OperationType.LIST, `users/${user.uid}/tasks`));

    return () => {
      unsubContacts();
      unsubCalls();
      unsubTasks();
    };
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const startCall = (contact?: Contact) => {
    setCurrentCall({ contact });
    setIsCalling(true);
    setTranscription(["Call started..."]);
  };

  const endCall = async () => {
    if (!user) return;
    
    const record: Partial<CallRecord> = {
      userId: user.uid,
      contactId: currentCall?.contact?.id || 'unknown',
      contactName: currentCall?.contact?.name || 'Unknown Number',
      timestamp: new Date().toISOString(),
      duration: 0, // Simplified
      transcription: transcription.join('\n'),
      aiTask: currentCall?.task?.title || 'None',
      status: 'completed'
    };

    try {
      await addDoc(collection(db, `users/${user.uid}/calls`), record);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `users/${user.uid}/calls`);
    }

    setIsCalling(false);
    setCurrentCall(null);
    setIsAiActive(false);
    setTranscription([]);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-16 h-16 bg-zinc-200 rounded-full mb-4"></div>
          <div className="h-4 w-32 bg-zinc-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center"
        >
          <div className="w-20 h-20 bg-black rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-xl">
            <Phone className="text-white w-10 h-10" />
          </div>
          <h1 className="text-4xl font-bold text-zinc-900 mb-4 tracking-tight">AI Voice Assistant</h1>
          <p className="text-zinc-500 mb-12 text-lg">Connect your calls with real-time AI intelligence.</p>
          <Button onClick={handleLogin} className="w-full py-4 text-lg">
            Sign in with Google
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col max-w-md mx-auto shadow-2xl relative overflow-hidden">
      {/* Header */}
      <header className="bg-white border-bottom border-zinc-100 p-6 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900">
            {activeTab === 'calls' ? 'Recent Calls' : activeTab === 'contacts' ? 'Contacts' : 'AI Tasks'}
          </h2>
          <p className="text-zinc-400 text-sm">Welcome back, {user.displayName?.split(' ')[0]}</p>
        </div>
        <button onClick={handleLogout} className="p-2 text-zinc-400 hover:text-zinc-900 transition-colors">
          <LogOut size={20} />
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6 pb-24">
        <AnimatePresence mode="wait">
          {activeTab === 'calls' && (
            <motion.div 
              key="calls"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="space-y-4"
            >
              {calls.length === 0 ? (
                <div className="text-center py-12 text-zinc-400">
                  <History size={48} className="mx-auto mb-4 opacity-20" />
                  <p>No call history yet</p>
                </div>
              ) : (
                calls.map(call => (
                  <Card key={call.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-zinc-100 rounded-full flex items-center justify-center text-zinc-600">
                        <Phone size={20} />
                      </div>
                      <div>
                        <h4 className="font-semibold text-zinc-900">{call.contactName}</h4>
                        <p className="text-xs text-zinc-400">{new Date(call.timestamp).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-medium px-2 py-1 bg-zinc-100 rounded-full text-zinc-600">
                        {call.aiTask !== 'None' ? 'AI Assisted' : 'Normal'}
                      </span>
                    </div>
                  </Card>
                ))
              )}
            </motion.div>
          )}

          {activeTab === 'contacts' && (
            <motion.div 
              key="contacts"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="space-y-4"
            >
              <div className="flex gap-2 mb-6">
                <div className="flex-1 bg-white border border-zinc-200 rounded-xl px-4 flex items-center gap-2">
                  <Search size={18} className="text-zinc-400" />
                  <input type="text" placeholder="Search contacts..." className="w-full py-2 outline-none text-sm" />
                </div>
                <Button onClick={() => setShowAddContact(true)} className="p-2">
                  <Plus size={24} />
                </Button>
              </div>

              {contacts.map(contact => (
                <Card key={contact.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-zinc-900 text-white rounded-full flex items-center justify-center font-bold">
                      {contact.name[0]}
                    </div>
                    <div>
                      <h4 className="font-semibold text-zinc-900">{contact.name}</h4>
                      <p className="text-xs text-zinc-400">{contact.phoneNumber}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        if (confirm('Delete contact?')) {
                          deleteDoc(doc(db, `users/${user.uid}/contacts`, contact.id))
                            .catch(e => handleFirestoreError(e, OperationType.DELETE, `users/${user.uid}/contacts/${contact.id}`));
                        }
                      }}
                      className="p-2 text-zinc-300 hover:text-red-500 transition-colors"
                    >
                      <X size={16} />
                    </button>
                    <button 
                      onClick={() => startCall(contact)}
                      className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center hover:bg-emerald-100 transition-colors"
                    >
                      <Phone size={18} />
                    </button>
                  </div>
                </Card>
              ))}
            </motion.div>
          )}

          {activeTab === 'tasks' && (
            <motion.div 
              key="tasks"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="space-y-4"
            >
              <div className="flex justify-between items-center mb-6">
                <p className="text-zinc-500 text-sm">Configure AI behavior for calls</p>
                <Button onClick={() => setShowAddTask(true)} variant="secondary" className="flex items-center gap-2">
                  <Plus size={18} /> New Task
                </Button>
              </div>

              {tasks.map(task => (
                <Card key={task.id} className="relative group">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-bold text-zinc-900">{task.title}</h4>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          if (confirm('Delete task?')) {
                            deleteDoc(doc(db, `users/${user.uid}/tasks`, task.id))
                              .catch(e => handleFirestoreError(e, OperationType.DELETE, `users/${user.uid}/tasks/${task.id}`));
                          }
                        }}
                        className="p-1 text-zinc-300 hover:text-red-500 transition-colors"
                      >
                        <X size={14} />
                      </button>
                      <Bot size={18} className="text-zinc-300" />
                    </div>
                  </div>
                  <p className="text-sm text-zinc-500 line-clamp-2">{task.instructions}</p>
                  <div className="mt-4 flex gap-2">
                    <Button 
                      variant="outline" 
                      className="text-xs py-1"
                      onClick={() => {
                        setCurrentCall({ task });
                        setIsCalling(true);
                      }}
                    >
                      Test with this task
                    </Button>
                  </div>
                </Card>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Navigation */}
      <nav className="bg-white border-t border-zinc-100 p-4 flex justify-around items-center sticky bottom-0">
        <NavButton active={activeTab === 'calls'} onClick={() => setActiveTab('calls')} icon={<History size={20} />} label="Calls" />
        <NavButton active={activeTab === 'contacts'} onClick={() => setActiveTab('contacts')} icon={<Users size={20} />} label="Contacts" />
        <NavButton active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} icon={<Bot size={20} />} label="AI Tasks" />
      </nav>

      {/* Call Overlay */}
      <AnimatePresence>
        {isCalling && (
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-0 bg-zinc-900 z-50 flex flex-col"
          >
            <div className="flex-1 p-8 flex flex-col items-center justify-center text-center">
              <div className="w-32 h-32 bg-zinc-800 rounded-full flex items-center justify-center mb-8 relative">
                <div className="absolute inset-0 rounded-full border-4 border-emerald-500/30 animate-ping"></div>
                <Users size={64} className="text-zinc-600" />
              </div>
              <h2 className="text-3xl font-bold text-white mb-2">
                {currentCall?.contact?.name || 'Unknown Number'}
              </h2>
              <p className="text-emerald-500 font-medium mb-12">Calling...</p>
              
              {/* AI Assistant Controls */}
              <div className="w-full max-w-xs space-y-4">
                <div className={`p-4 rounded-2xl border transition-all ${isAiActive ? 'bg-indigo-500/10 border-indigo-500/50' : 'bg-zinc-800 border-zinc-700'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isAiActive ? 'bg-indigo-500 text-white' : 'bg-zinc-700 text-zinc-400'}`}>
                        <Bot size={18} />
                      </div>
                      <div className="text-left">
                        <p className="text-white text-sm font-bold">AI Assistant</p>
                        <p className="text-zinc-500 text-xs">{isAiActive ? 'Active & Listening' : 'Inactive'}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setIsAiActive(!isAiActive)}
                      className={`w-12 h-6 rounded-full relative transition-colors ${isAiActive ? 'bg-indigo-500' : 'bg-zinc-700'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isAiActive ? 'right-1' : 'left-1'}`}></div>
                    </button>
                  </div>
                  
                  {isAiActive && (
                    <div className="text-left">
                      <p className="text-indigo-300 text-[10px] uppercase tracking-wider font-bold mb-2">Current Task</p>
                      <p className="text-zinc-300 text-xs italic">"{currentCall?.task?.title || 'General Assistance'}"</p>
                    </div>
                  )}
                </div>

                {/* Transcription View */}
                <div className="h-40 bg-black/40 rounded-2xl p-4 overflow-y-auto text-left border border-zinc-800">
                  <p className="text-zinc-600 text-[10px] uppercase tracking-wider font-bold mb-2">Live Transcription</p>
                  <div className="space-y-2">
                    {transcription.map((line, i) => (
                      <p key={i} className="text-zinc-300 text-xs">{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-12 flex justify-center gap-8">
              <button className="w-16 h-16 bg-zinc-800 text-white rounded-full flex items-center justify-center hover:bg-zinc-700 transition-colors">
                <MicOff size={24} />
              </button>
              <button 
                onClick={endCall}
                className="w-16 h-16 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
              >
                <X size={32} />
              </button>
              <button className="w-16 h-16 bg-zinc-800 text-white rounded-full flex items-center justify-center hover:bg-zinc-700 transition-colors">
                <Settings size={24} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <Modal show={showAddContact} onClose={() => setShowAddContact(false)} title="Add Contact">
        <AddContactForm userId={user.uid} onClose={() => setShowAddContact(false)} />
      </Modal>

      <Modal show={showAddTask} onClose={() => setShowAddTask(false)} title="New AI Task">
        <AddTaskForm userId={user.uid} onClose={() => setShowAddTask(false)} />
      </Modal>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: any) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-colors ${active ? 'text-zinc-900' : 'text-zinc-400'}`}
    >
      <div className={`p-2 rounded-xl transition-colors ${active ? 'bg-zinc-100' : 'bg-transparent'}`}>
        {icon}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}

function Modal({ show, onClose, title, children }: any) {
  return (
    <AnimatePresence>
      {show && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          ></motion.div>
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="bg-white w-full max-w-md rounded-3xl p-8 relative z-10 shadow-2xl"
          >
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-bold text-zinc-900">{title}</h3>
              <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-900">
                <X size={24} />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function AddContactForm({ userId, onClose }: any) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, `users/${userId}/contacts`), {
        userId,
        name,
        phoneNumber: phone,
        timestamp: serverTimestamp()
      });
      onClose();
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `users/${userId}/contacts`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Full Name</label>
        <input 
          required
          type="text" 
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="John Doe" 
          className="w-full p-4 bg-zinc-50 border border-zinc-100 rounded-2xl outline-none focus:border-zinc-300 transition-colors" 
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Phone Number</label>
        <input 
          required
          type="tel" 
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="+1 (555) 000-0000" 
          className="w-full p-4 bg-zinc-50 border border-zinc-100 rounded-2xl outline-none focus:border-zinc-300 transition-colors" 
        />
      </div>
      <Button type="submit" className="w-full py-4">Save Contact</Button>
    </form>
  );
}

function AddTaskForm({ userId, onClose }: any) {
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, `users/${userId}/tasks`), {
        userId,
        title,
        instructions,
        timestamp: serverTimestamp()
      });
      onClose();
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `users/${userId}/tasks`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Task Title</label>
        <input 
          required
          type="text" 
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Appointment Booking" 
          className="w-full p-4 bg-zinc-50 border border-zinc-100 rounded-2xl outline-none focus:border-zinc-300 transition-colors" 
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">AI Instructions</label>
        <textarea 
          required
          rows={4}
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          placeholder="Describe what the AI should do during the call..." 
          className="w-full p-4 bg-zinc-50 border border-zinc-100 rounded-2xl outline-none focus:border-zinc-300 transition-colors resize-none" 
        />
      </div>
      <Button type="submit" className="w-full py-4">Create Task</Button>
    </form>
  );
}
