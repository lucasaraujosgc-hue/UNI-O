
import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, User, Loader2, Minimize2, Maximize2, Sparkles } from 'lucide-react';
import { api } from '../services/api';

interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
  isCommand?: boolean;
}

const CopilotPanel: React.FC = () => {
  const [messages, setMessages] = useState<CopilotMessage[]>([
    { role: 'assistant', content: 'Olá! Sou seu copiloto de IA. Como posso ajudar com seus contatos e processos hoje?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: CopilotMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await api.askCopilot(input);
      const assistantMessage: CopilotMessage = { 
        role: 'assistant', 
        content: response.reply 
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Desculpe, tive um erro ao processar sua solicitação.' 
      }]);
    } finally {
      setLoading(false);
    }
  };

  if (isMinimized) {
    return (
      <button 
        onClick={() => setIsMinimized(false)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-emerald-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-emerald-700 transition-all z-50 animate-pulse"
        title="IA Copiloto"
      >
        <Bot size={28} />
      </button>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
      <div className="bg-emerald-600 p-3 flex justify-between items-center text-white">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-emerald-100" />
          <h3 className="font-bold text-sm tracking-tight">Copiloto Inteligente</h3>
        </div>
        <button onClick={() => setIsMinimized(true)} className="p-1 hover:bg-emerald-500 rounded transition-colors text-white">
          <Minimize2 size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex gap-3 max-w-[85%] ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${m.role === 'assistant' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
                {m.role === 'assistant' ? <Bot size={18} /> : <User size={18} />}
              </div>
              <div className={`p-3 rounded-2xl text-sm shadow-sm ${
                m.role === 'assistant' 
                  ? 'bg-white text-gray-800 border border-emerald-50' 
                  : 'bg-emerald-600 text-white'
              }`}>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex gap-3 max-w-[85%]">
              <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-sm">
                <Loader2 size={18} className="animate-spin" />
              </div>
              <div className="p-3 bg-white border border-emerald-50 rounded-2xl shadow-sm italic text-gray-400 text-xs flex items-center gap-2">
                Processando...
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-gray-100 bg-white">
        <form onSubmit={handleSendMessage} className="relative">
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte ao copiloto..."
            className="w-full pl-4 pr-12 py-2.5 bg-slate-50 border border-slate-200 rounded-full text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
            disabled={loading}
          />
          <button 
            type="submit"
            disabled={!input.trim() || loading}
            className="absolute right-1.5 top-1.5 w-8 h-8 bg-emerald-600 text-white rounded-full flex items-center justify-center hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            <Send size={14} />
          </button>
        </form>
        <p className="text-[10px] text-gray-400 mt-2 text-center">
          Dica: Peça para resumir conversas ou criar lembretes.
        </p>
      </div>
    </div>
  );
};

export default CopilotPanel;
