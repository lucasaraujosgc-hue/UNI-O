import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { Plus, MessageCircle, Edit2, X, Trash2, Play, Pause, CheckCheck } from 'lucide-react';
import { Column, Chat, Tag, Message } from '../types';
import { format, isSameDay, isToday, isYesterday } from 'date-fns';

function AudioPlayer({ src }: { src: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const togglePlay = () => {
    if (audioRef.current) {
      isPlaying ? audioRef.current.pause() : audioRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => audioRef.current && setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
  const handleLoadedMetadata = () => audioRef.current && setDuration(audioRef.current.duration);
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (audioRef.current) {
      audioRef.current.currentTime = (Number(e.target.value) / 100) * audioRef.current.duration;
      setProgress(Number(e.target.value));
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2 bg-black/5 rounded-full p-2 min-w-[200px] w-full max-w-[300px]">
      <button onClick={togglePlay} className="w-8 h-8 flex items-center justify-center bg-blue-500 text-white rounded-full hover:bg-blue-600 flex-shrink-0">
        {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-1" />}
      </button>
      <div className="flex-1 flex flex-col justify-center">
        <input type="range" min="0" max="100" value={progress || 0} onChange={handleSeek} className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-500" />
        <div className="flex justify-between text-[10px] text-gray-500 mt-1 px-1">
          <span>{formatTime(audioRef.current?.currentTime || 0)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <audio ref={audioRef} src={src} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata} onEnded={() => { setIsPlaying(false); setProgress(0); }} className="hidden" />
    </div>
  );
}

export default function WhatsAppKanban() {
  const [columns, setColumns] = useState<Column[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnColor, setNewColumnColor] = useState('#e2e8f0');
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editColumnName, setEditColumnName] = useState('');
  const [editColumnColor, setEditColumnColor] = useState('#e2e8f0');

  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editTagName, setEditTagName] = useState('');
  const [editTagColor, setEditTagColor] = useState('#3b82f6');

  const [chatToTag, setChatToTag] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const [editingChatNameId, setEditingChatNameId] = useState<string | null>(null);
  const [editChatName, setEditChatName] = useState('');

  const [chatPanelWidth, setChatPanelWidth] = useState<number>(384);
  const isResizingRef = useRef(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const prevChatIdRef = useRef<string | undefined>(undefined);
  const firstLoadRef = useRef<boolean>(true);

  const apiFetch = async (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('cm_auth_token');
    const headers = new Headers(options.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      localStorage.removeItem('cm_auth_token');
      window.location.href = '/';
      throw new Error('Unauthorized');
    }
    return res;
  };

  useEffect(() => {
    const token = localStorage.getItem('cm_auth_token');
    if (!token) return;

    fetchData();

    const socket = io({ query: { token } });

    socket.on('columns_updated', fetchData);
    socket.on('tags_updated', fetchData);
    socket.on('chat_updated', fetchData);
    socket.on('new_chat', fetchData);
    socket.on('chat_deleted', (data: { id: string }) => {
      if (selectedChat?.id === data.id) setSelectedChat(null);
      fetchData();
    });
    socket.on('chat_tags_updated', fetchData);

    socket.on('new_message', (msg: Message) => {
      if (selectedChat && msg.chat_id === selectedChat.id) {
        setMessages(prev => [...prev, msg]);
      }
      fetchData(); 
    });

    return () => { socket.disconnect(); };
  }, [selectedChat?.id]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = document.body.clientWidth - e.clientX;
      if (newWidth > 300 && newWidth < 800) setChatPanelWidth(newWidth);
    };
    const handleMouseUp = () => { if (isResizingRef.current) isResizingRef.current = false; document.body.style.cursor = ''; };
    document.addEventListener('mousemove', handleMouseMove); document.addEventListener('mouseup', handleMouseUp);
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
  }, []);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => messagesEndRef.current?.scrollIntoView({ behavior });

  useEffect(() => {
    if (selectedChat?.id !== prevChatIdRef.current) {
      prevChatIdRef.current = selectedChat?.id;
      firstLoadRef.current = true;
      return;
    }
    if (firstLoadRef.current && messages.length > 0 && messages[0].chat_id === selectedChat?.id) {
      firstLoadRef.current = false;
      scrollToBottom('auto');
      return;
    }
    const scrollContainer = chatScrollContainerRef.current;
    if (!scrollContainer) { scrollToBottom(); return; }
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 200;
    const lastMsg = messages[messages.length - 1];
    if (!firstLoadRef.current && (isNearBottom || lastMsg?.from_me)) scrollToBottom('smooth');
  }, [messages, selectedChat?.id]);

  const fetchData = async () => {
    try {
      const [colsRes, chatsRes, tagsRes] = await Promise.all([ apiFetch('/api/columns'), apiFetch('/api/chats'), apiFetch('/api/tags') ]);
      setColumns(await colsRes.json());
      const newChats = await chatsRes.json();
      setChats(newChats);
      setTags(await tagsRes.json());
      setSelectedChat(prev => {
        if (!prev) return null;
        const updated = newChats.find((c: Chat) => c.id === prev.id);
        return updated ? { ...prev, ...updated } : prev;
      });
    } catch (error) {}
  };

  const loadMessages = async (chatId: string) => {
    try { const res = await apiFetch(`/api/chats/${chatId}/messages`); setMessages(await res.json()); } catch (error) {}
  };

  const handleChatSelect = async (chat: Chat) => {
    setSelectedChat(chat);
    setIsRightSidebarOpen(true);
    if (chat.unread_count > 0) {
      try { await apiFetch(`/api/chats/${chat.id}/read`, { method: 'PUT' }); setChats(prev => prev.map(c => c.id === chat.id ? { ...c, unread_count: 0 } : c)); } catch (error) {}
    }
    loadMessages(chat.id);
  };

  const handleDeleteChat = async (chatId: string) => {
    if (window.confirm('Tem certeza que deseja excluir esta conversa? Todos os dados serão perdidos.')) {
      try { await apiFetch(`/api/chats/${chatId}`, { method: 'DELETE' }); if (selectedChat?.id === chatId) setSelectedChat(null); fetchData(); } catch (error) {}
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedChat) return;
    try { await apiFetch(`/api/chats/${selectedChat.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: newMessage }) }); setNewMessage(''); } catch (error) {}
  };

  const handleFileUpload = async (file: File) => {
    if (!selectedChat) return;
    setUploadingMedia(true);
    const formData = new FormData();
    formData.append('media', file);
    if (newMessage.trim()) formData.append('body', newMessage);
    try { await apiFetch(`/api/chats/${selectedChat.id}/messages`, { method: 'POST', body: formData }); setNewMessage(''); } catch (error) {} finally { setUploadingMedia(false); }
  };

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files[0]); };
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleAddColumn = async () => {
    if (!newColumnName.trim()) return;
    try { await apiFetch('/api/columns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'col-' + Date.now(), name: newColumnName, position: columns.length, color: newColumnColor }) }); setNewColumnName(''); setNewColumnColor('#e2e8f0'); setIsAddingColumn(false); } catch (error) {}
  };

  const handleMoveChat = async (chatId: string, columnId: string) => {
    try { await apiFetch(`/api/chats/${chatId}/column`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ column_id: columnId }) }); } catch (error) {}
  };

  const handleEditColumn = async (columnId: string) => {
    if (!editColumnName.trim()) return;
    const column = columns.find(c => c.id === columnId);
    if (!column) return;
    try { await apiFetch(`/api/columns/${columnId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editColumnName, position: column.position, color: editColumnColor }) }); setEditingColumnId(null); } catch (error) {}
  };

  const handleDeleteColumn = async (columnId: string) => {
    if (columns.length <= 1) { alert('Não é possível excluir a última coluna.'); return; }
    if (confirm('Tem certeza que deseja excluir esta coluna? Os chats serão movidos para outra coluna.')) { try { await apiFetch(`/api/columns/${columnId}`, { method: 'DELETE' }); setEditingColumnId(null); } catch (error) {} }
  };

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    try { await apiFetch('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'tag-' + Date.now(), name: newTagName, color: newTagColor }) }); setNewTagName(''); setIsAddingTag(false); } catch (error) {}
  };

  const handleEditTag = async (id: string) => {
    if (!editTagName.trim()) return;
    try { await apiFetch(`/api/tags/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editTagName, color: editTagColor }) }); setEditingTagId(null); } catch (error) {}
  };

  const handleDeleteTag = async (id: string) => {
    if (window.confirm('Tem certeza?')) { try { await apiFetch(`/api/tags/${id}`, { method: 'DELETE' }); setEditingTagId(null); } catch (error) {} }
  };

  const handleAssignTag = async (chatId: string, tagId: string) => {
    try { await apiFetch(`/api/chats/${chatId}/tags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_id: tagId }) }); setChatToTag(null); } catch (error) {}
  };

  const handleRemoveTag = async (chatId: string, tagId: string) => { try { await apiFetch(`/api/chats/${chatId}/tags/${tagId}`, { method: 'DELETE' }); } catch (error) {} };

  const handleEditChatName = async (chatId: string) => {
    if (!editChatName.trim()) return;
    try { await apiFetch(`/api/chats/${chatId}/name`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editChatName }) }); setEditingChatNameId(null); } catch (error) {}
  };

  const handleDragStart = (e: React.DragEvent, chatId: string) => e.dataTransfer.setData('chatId', chatId);
  const handleColumnDrop = (e: React.DragEvent, columnId: string) => { e.preventDefault(); const chatId = e.dataTransfer.getData('chatId'); if (chatId) handleMoveChat(chatId, columnId); };
  const handleColumnDragOver = (e: React.DragEvent) => e.preventDefault();

  const filteredChats = chats.filter(c => {
    const matchesTags = selectedTagFilters.length === 0 || selectedTagFilters.some(t => c.tag_ids.includes(t));
    const searchQueryLower = searchQuery.toLowerCase();
    const matchesSearch = searchQuery === '' || (c.name && c.name.toLowerCase().includes(searchQueryLower)) || (c.phone && c.phone.toLowerCase().includes(searchQueryLower)) || (c.last_message && c.last_message.toLowerCase().includes(searchQueryLower));
    return matchesTags && matchesSearch;
  });

  return (
    <div className="flex h-full w-full bg-slate-50 font-sans overflow-hidden">
      {isSidebarOpen && (
        <div className="w-64 bg-white border-r border-slate-200 shadow-sm flex flex-col flex-shrink-0 z-10 h-full">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle className="text-emerald-500" />
              <h1 className="font-bold text-lg text-slate-800 tracking-tight">Filtros & Tags</h1>
            </div>
          </div>
          <div className="p-4 border-b border-slate-100">
            <input type="text" placeholder="Buscar chats..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-shadow bg-slate-50" />
          </div>
          <div className="p-4 flex-1 overflow-y-auto no-scrollbar">
            <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 mt-4">Filtro de Tags</h2>
            <div className="flex flex-wrap gap-1 mb-6">
              {tags.map(tag => {
                const isSelected = selectedTagFilters.includes(tag.id);
                return (
                  <button key={tag.id} onClick={() => setSelectedTagFilters(prev => isSelected ? prev.filter(id => id !== tag.id) : [...prev, tag.id])} className={`text-xs px-2 py-1 rounded-full border flex items-center gap-1 transition-colors ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }}></div>{tag.name}
                  </button>
                );
              })}
            </div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Gerenciar Tags</h2>
            <div className="space-y-2">
              {tags.map(tag => (
                <div key={tag.id} className="flex items-center justify-between text-sm group">
                  {editingTagId === tag.id ? (
                    <div className="flex-1 flex flex-col gap-2 p-2 bg-gray-50 border border-gray-200 rounded-md">
                      <input type="text" value={editTagName} onChange={(e) => setEditTagName(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500" autoFocus />
                      <div className="flex items-center gap-2">
                        <input type="color" value={editTagColor} onChange={(e) => setEditTagColor(e.target.value)} className="w-6 h-6 p-0 border-0 rounded cursor-pointer" />
                        <span className="text-xs text-gray-500">Cor</span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => handleEditTag(tag.id)} className="flex-1 bg-blue-600 text-white text-[10px] px-2 py-1 rounded hover:bg-blue-700">Salvar</button>
                        <button onClick={() => setEditingTagId(null)} className="flex-1 bg-gray-200 text-gray-700 text-[10px] px-2 py-1 rounded hover:bg-gray-300">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }}></div><span>{tag.name}</span></div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditingTagId(tag.id); setEditTagName(tag.name); setEditTagColor(tag.color); }} className="text-gray-400 hover:text-blue-500 p-1"><Edit2 size={14} /></button>
                        <button onClick={() => handleDeleteTag(tag.id)} className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {isAddingTag ? (
                <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded-md">
                  <input type="text" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Nome da tag" className="w-full border border-gray-300 rounded px-2 py-1 text-xs mb-2 focus:outline-none focus:border-blue-500" autoFocus />
                  <div className="flex flex-col gap-2 mt-2">
                    <input type="color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)} className="w-6 h-6 p-0 border-0 rounded" />
                    <div className="flex gap-1">
                      <button onClick={handleAddTag} className="bg-blue-600 text-white text-xs px-2 py-1 rounded">Add</button>
                      <button onClick={() => setIsAddingTag(false)} className="bg-gray-200 text-gray-700 text-xs px-2 py-1 rounded">Cancel</button>
                    </div>
                  </div>
                </div>
              ) : (
                <button onClick={() => setIsAddingTag(true)} className="text-blue-600 text-xs flex mt-2 hover:underline"><Plus size={14}/> Nova Tag</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <div className="flex-1 overflow-x-auto overflow-y-hidden px-6 pt-6 pb-2 mb-4 flex gap-6 items-start h-full">
        {columns.map(column => (
          <div key={column.id} className="flex-shrink-0 w-80 bg-slate-100/50 rounded-2xl border border-slate-200/60 flex flex-col max-h-full overflow-hidden shadow-sm" onDrop={(e) => handleColumnDrop(e, column.id)} onDragOver={handleColumnDragOver}>
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-100/80 group" style={{ borderTop: `4px solid ${column.color || '#cbd5e1'}` }}>
              {editingColumnId === column.id ? (
                <div className="flex-1 flex flex-col gap-2">
                  <input type="text" value={editColumnName} onChange={(e) => setEditColumnName(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1 text-sm" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleEditColumn(column.id)} />
                  <div className="flex items-center gap-2">
                    <input type="color" value={editColumnColor} onChange={(e) => setEditColumnColor(e.target.value)} className="w-6 h-6 rounded" />
                    <button onClick={() => handleEditColumn(column.id)} className="text-blue-600 text-xs bg-blue-50 px-2 py-1 rounded">Save</button>
                    <button onClick={() => setEditingColumnId(null)} className="text-gray-500 text-xs bg-gray-100 px-2 py-1 rounded">Cancel</button>
                    <button onClick={() => handleDeleteColumn(column.id)} className="text-red-600 text-xs ml-auto"><X size={14} /></button>
                  </div>
                </div>
              ) : (
                <h3 className="font-semibold text-slate-700 flex-1 cursor-pointer hover:text-emerald-600 flex items-center gap-2" onClick={() => { setEditingColumnId(column.id); setEditColumnName(column.name); setEditColumnColor(column.color || '#e2e8f0'); }}>
                  <span className="w-3 h-3 rounded-full shadow-sm border border-slate-200" style={{ backgroundColor: column.color || '#e2e8f0' }}></span>
                  <span className="tracking-tight">{column.name}</span>
                </h3>
              )}
              <span className="bg-white text-slate-500 shadow-sm border border-slate-200 text-xs px-2.5 py-0.5 rounded-full font-bold ml-2">
                {filteredChats.filter(c => c.column_id === column.id).length}
              </span>
            </div>
            
            <div className="p-3 flex-1 overflow-y-auto space-y-3 no-scrollbar custom-column-scroll h-full">
              {filteredChats.filter(c => c.column_id === column.id).map(chat => (
                <div key={chat.id} onClick={() => handleChatSelect(chat)} draggable onDragStart={(e) => handleDragStart(e, chat.id)} className={`group bg-white p-4 rounded-xl shadow-sm border cursor-pointer hover:shadow-md hover:border-slate-300 transition-all ${selectedChat?.id === chat.id ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-slate-200'} flex flex-col relative`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2 overflow-hidden">
                      {chat.profile_pic && <img src={chat.profile_pic} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />}
                      {!chat.profile_pic && <div className="w-8 h-8 rounded-full border border-slate-100 bg-slate-100 flex items-center justify-center text-slate-500 font-semibold">{chat.name ? chat.name.charAt(0).toUpperCase() : '?'}</div>}
                      {editingChatNameId === chat.id ? (
                        <input type="text" value={editChatName} onChange={(e) => setEditChatName(e.target.value)} onBlur={() => handleEditChatName(chat.id)} onKeyDown={(e) => e.key === 'Enter' && handleEditChatName(chat.id)} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-800 border-b border-emerald-500 focus:outline-none w-full bg-slate-50 px-1 rounded-t" autoFocus />
                      ) : (
                        <h4 className="font-semibold text-slate-800 tracking-tight truncate pr-2 flex items-center gap-1 group/name">
                          {chat.name || chat.phone}
                          <button onClick={(e) => { e.stopPropagation(); setEditingChatNameId(chat.id); setEditChatName(chat.name || chat.phone || ''); }} className="opacity-0 group-hover/name:opacity-100 text-slate-400 hover:text-emerald-500"><Edit2 size={12} /></button>
                        </h4>
                      )}
                    </div>
                    {chat.unread_count > 0 && <span className="bg-emerald-500 text-white shadow-sm text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0">{chat.unread_count}</span>}
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mb-3 flex items-center gap-1.5 opacity-90 leading-relaxed">
                    {chat.last_message_from_me === 1 && <CheckCheck size={14} className="text-sky-500 flex-shrink-0" />}
                    <span className="truncate">{chat.last_message}</span>
                  </p>
                  
                  <div className="flex justify-between items-center mt-auto">
                    <div className="flex flex-wrap gap-1.5">
                      {chat.tag_ids.map(tagId => {
                        const tag = tags.find(t => t.id === tagId);
                        return tag ? (
                          <div key={tagId} className="flex items-center gap-1 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-md text-[10px] font-medium text-slate-600 group/tag shadow-sm">
                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                            <span>{tag.name}</span>
                            <button onClick={(e) => { e.stopPropagation(); handleRemoveTag(chat.id, tagId); }} className="opacity-0 group-hover/tag:opacity-100 text-slate-400 hover:text-rose-500 ml-0.5"><X size={10} /></button>
                          </div>
                        ) : null;
                      })}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className="text-[10px] font-medium text-slate-400 group-hover:opacity-0 transition-opacity">
                        {chat.last_message_time ? format(new Date(chat.last_message_time), 'HH:mm') : ''}
                      </span>
                      <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-white pl-2">
                        <button onClick={(e) => { e.stopPropagation(); setChatToTag(chat.id); }} className="text-slate-400 hover:text-emerald-500 p-1"><Plus size={12} /></button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id); }} className="text-slate-400 hover:text-rose-500 p-1"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex-shrink-0 w-80">
          {isAddingColumn ? (
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <input type="text" value={newColumnName} onChange={(e) => setNewColumnName(e.target.value)} placeholder="Nome da coluna" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:border-emerald-500 bg-slate-50" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleAddColumn()} />
              <div className="flex gap-2">
                <button onClick={handleAddColumn} className="bg-emerald-600 text-white text-xs px-4 py-2 rounded-lg font-medium flex-1">Salvar</button>
                <button onClick={() => setIsAddingColumn(false)} className="bg-slate-100 text-slate-600 text-xs px-4 py-2 rounded-lg font-medium flex-1">Cancelar</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setIsAddingColumn(true)} className="w-full flex items-center justify-center gap-2 bg-slate-100/50 border-2 border-dashed border-slate-300 text-slate-500 rounded-2xl py-5 font-medium hover:bg-slate-100 hover:text-emerald-600 hover:border-emerald-300 transition-colors">
              <Plus size={20} /> Nova Coluna
            </button>
          )}
        </div>
      </div>
      </div>

      {selectedChat && isRightSidebarOpen && (
        <div className="bg-white border-l border-slate-200 flex flex-col z-20 relative flex-shrink-0 h-full" style={{ width: `${chatPanelWidth}px` }}>
          <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-400 opacity-50 z-30 transition-colors" onMouseDown={(e) => { e.preventDefault(); isResizingRef.current = true; document.body.style.cursor = 'col-resize'; }} />
          <div className="p-4 border-b border-slate-100 flex flex-col bg-white">
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-3">
                {selectedChat.profile_pic ? (
                  <img src={selectedChat.profile_pic} alt="" className="w-11 h-11 rounded-full object-cover flex-shrink-0 shadow-sm border border-slate-100" />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 font-bold text-lg flex-shrink-0">{selectedChat.name ? selectedChat.name.charAt(0).toUpperCase() : '?'}</div>
                )}
                <div>
                  <h3 className="font-bold text-slate-800 text-base">{selectedChat.name || selectedChat.phone}</h3>
                  <p className="text-sm text-slate-500">{selectedChat.phone}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setIsRightSidebarOpen(false)} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-1 items-center">
              {selectedChat.tag_ids.map(tagId => {
                const tag = tags.find(t => t.id === tagId);
                return tag ? <span key={tagId} className="text-[10px] px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: tag.color }}>{tag.name}</span> : null;
              })}
              <div className="relative">
                <button onClick={() => setChatToTag(chatToTag === selectedChat.id ? null : selectedChat.id)} className="text-[10px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full hover:bg-gray-300 flex items-center gap-1"><Plus size={10} /> Add Tag</button>
                {chatToTag === selectedChat.id && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 shadow-lg rounded-md p-2 w-48 z-20">
                    <h4 className="text-xs font-semibold text-gray-500 mb-2">Selecione uma Tag</h4>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {tags.filter(t => !selectedChat.tag_ids.includes(t.id)).map(tag => (
                        <button key={tag.id} onClick={() => handleAssignTag(selectedChat.id, tag.id)} className="w-full text-left text-xs px-2 py-1 hover:bg-gray-100 rounded flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }}></div>{tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div ref={chatScrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#e5ddd5]" onDrop={handleDrop} onDragOver={handleDragOver} style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')", backgroundRepeat: 'repeat', backgroundSize: '400px' }}>
            {messages.map((msg, index) => {
              const currentMsgDate = new Date(msg.timestamp);
              const prevMsgDate = index > 0 ? new Date(messages[index - 1].timestamp) : null;
              const showDateSeparator = !prevMsgDate || !isSameDay(currentMsgDate, prevMsgDate);
              let dateLabel = showDateSeparator ? (isToday(currentMsgDate) ? 'Hoje' : isYesterday(currentMsgDate) ? 'Ontem' : format(currentMsgDate, 'dd/MM/yyyy')) : '';

              return (
                <React.Fragment key={msg.id}>
                  {showDateSeparator && (
                    <div className="flex justify-center my-6"><span className="bg-[#e1f3fb] border border-[#d6eaf5] text-slate-600 font-medium text-[11px] uppercase tracking-wide px-3 py-1 rounded-lg">{dateLabel}</span></div>
                  )}
                  <div className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[14px] leading-relaxed shadow-sm ${msg.from_me ? 'bg-[#dcf8c6]' : 'bg-white'}`}>
                      {msg.media_url && (
                        <div className="mb-2">
                          {msg.media_type?.startsWith('image/') ? <img src={msg.media_url} alt="Media" className="max-w-full rounded-md max-h-64 object-contain cursor-pointer" onClick={() => setZoomedImage(msg.media_url!)} /> :
                           msg.media_type?.startsWith('audio/') ? <AudioPlayer src={msg.media_url} /> :
                           msg.media_type?.startsWith('video/') ? <video controls src={msg.media_url} className="max-w-full rounded-md max-h-64 shadow-sm" /> :
                           <a href={msg.media_url} target="_blank" className="text-blue-500 underline font-medium">Baixar Documento</a>}
                        </div>
                      )}
                      {msg.body && <p className="whitespace-pre-wrap">{msg.body}</p>}
                      <span className="text-[10px] text-gray-500 block text-right mt-1">{format(new Date(msg.timestamp), 'HH:mm')}</span>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
            {uploadingMedia && <div className="text-sm italic text-gray-500 text-right">Enviando arquivo...</div>}
            <div ref={messagesEndRef} />
          </div>
          
          <div className="p-3 border-t border-slate-200 bg-white">
            <form onSubmit={handleSendMessage} className="flex gap-2 items-center">
              <label className="cursor-pointer text-slate-400 hover:text-emerald-600 p-2"><Plus size={22} /><input type="file" className="hidden" onChange={(e) => e.target.files && handleFileUpload(e.target.files[0])} disabled={uploadingMedia} /></label>
              <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Mensagem..." className="flex-1 border border-slate-200 bg-slate-50 rounded-full px-5 py-2.5 text-[13px] focus:outline-none focus:border-emerald-500" disabled={uploadingMedia} />
              <button type="submit" disabled={!newMessage.trim() && !uploadingMedia} className="bg-emerald-600 text-white rounded-full w-10 h-10 flex items-center justify-center hover:bg-emerald-700 disabled:opacity-50"><Play size={16} /></button>
            </form>
          </div>
        </div>
      )}

      {zoomedImage && (
        <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setZoomedImage(null)}>
          <button className="absolute top-4 right-4 text-white p-2" onClick={() => setZoomedImage(null)}><X size={32} /></button>
          <img src={zoomedImage} alt="Zoomed" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
