
import React, { useState } from 'react';
import { Save, User, Mail, MessageCircle, FileText, Check, LayoutTemplate, Link as LinkIcon, Plus, Trash, Clock, CalendarDays, Star, Tag, Smartphone, Send, Loader2 } from 'lucide-react';
import { UserSettings, CategoryRule } from '../types';
import { DOCUMENT_CATEGORIES } from '../constants';
import { api } from '../services/api';

interface SettingsProps {
  settings: UserSettings;
  onSave: (newSettings: UserSettings) => void;
}

const Settings: React.FC<SettingsProps> = ({ settings, onSave }) => {
  const [activeTab, setActiveTab] = useState<'signatures' | 'categories' | 'documents' | 'bindings' | 'due_dates' | 'daily'>('signatures');
  const [formData, setFormData] = useState<UserSettings>(settings);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newCustomCategory, setNewCustomCategory] = useState('');
  const [loadingTest, setLoadingTest] = useState(false);
  
  // Combina categorias padrão com as customizadas para os dropdowns
  const allCategories = [...DOCUMENT_CATEGORIES, ...(formData.customCategories || [])];
  const [selectedCategoryForKeyword, setSelectedCategoryForKeyword] = useState(allCategories[0]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
        await api.saveSettings(formData); // Salva no servidor
        onSave(formData); // Atualiza estado local
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
        console.error(e);
        alert("Erro ao salvar configurações no servidor.");
    } finally {
        setIsSaving(false);
    }
  };

  const toggleCategory = (category: string) => {
    setFormData(prev => {
      const current = prev.visibleDocumentCategories;
      if (current.includes(category)) {
        return { ...prev, visibleDocumentCategories: current.filter(c => c !== category) };
      } else {
        return { ...prev, visibleDocumentCategories: [...current, category] };
      }
    });
  };

  const togglePriority = (category: string) => {
      setFormData(prev => {
          const currentPriorities = prev.priorityCategories || [];
          if (currentPriorities.includes(category)) {
              return { ...prev, priorityCategories: currentPriorities.filter(c => c !== category) };
          } else {
              return { ...prev, priorityCategories: [...currentPriorities, category] };
          }
      });
  };

  const addKeyword = () => {
    if (!newKeyword.trim()) return;
    
    setFormData(prev => {
      const currentKeywords = prev.categoryKeywords[selectedCategoryForKeyword] || [];
      return {
        ...prev,
        categoryKeywords: {
          ...prev.categoryKeywords,
          [selectedCategoryForKeyword]: [...currentKeywords, newKeyword.trim()]
        }
      };
    });
    setNewKeyword('');
  };

  const removeKeyword = (category: string, keywordToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      categoryKeywords: {
        ...prev.categoryKeywords,
        [category]: prev.categoryKeywords[category].filter(k => k !== keywordToRemove)
      }
    }));
  };

  const addCustomCategory = () => {
      if (!newCustomCategory.trim()) return;
      if (allCategories.includes(newCustomCategory.trim())) {
          alert('Categoria já existe!');
          return;
      }
      setFormData(prev => ({
          ...prev,
          customCategories: [...(prev.customCategories || []), newCustomCategory.trim()]
      }));
      setNewCustomCategory('');
  };

  const removeCustomCategory = (cat: string) => {
      if(confirm(`Excluir a categoria "${cat}"?`)) {
          setFormData(prev => ({
              ...prev,
              customCategories: (prev.customCategories || []).filter(c => c !== cat)
          }));
      }
  };

  const updateRule = (category: string, field: keyof CategoryRule, value: any) => {
    setFormData(prev => ({
      ...prev,
      categoryRules: {
        ...prev.categoryRules,
        [category]: {
          ...(prev.categoryRules[category] || { day: 1, rule: 'fixo' }),
          [field]: value
        }
      }
    }));
  };

  const handleTestDaily = async () => {
      if (!formData.dailySummaryNumber) {
          alert("Preencha um número de WhatsApp primeiro.");
          return;
      }
      
      setLoadingTest(true);
      try {
          // Salva antes de testar para garantir que o backend tenha os dados atualizados
          await api.saveSettings(formData);
          onSave(formData);
          
          await api.triggerDailySummary();
          alert("Disparo solicitado! Verifique seu WhatsApp.");
      } catch (e: any) {
          alert("Erro ao disparar resumo: " + e.message);
      } finally {
          setLoadingTest(false);
      }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <User className="w-6 h-6 text-blue-600" /> Configurações do Usuário
          </h1>
          <p className="text-gray-500">Gerencie assinaturas, categorias e automações.</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all disabled:opacity-70"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {isSaving ? 'Salvando...' : saveSuccess ? 'Salvo!' : 'Salvar Alterações'}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden min-h-[600px]">
        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200 overflow-x-auto">
          <button
            onClick={() => setActiveTab('signatures')}
            className={`px-4 py-4 font-medium text-sm flex items-center gap-2 transition-colors border-b-2 whitespace-nowrap
              ${activeTab === 'signatures' ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Mail className="w-4 h-4" /> Assinaturas
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`px-4 py-4 font-medium text-sm flex items-center gap-2 transition-colors border-b-2 whitespace-nowrap
              ${activeTab === 'categories' ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Tag className="w-4 h-4" /> Criar Categorias
          </button>
          <button
            onClick={() => setActiveTab('documents')}
            className={`px-4 py-4 font-medium text-sm flex items-center gap-2 transition-colors border-b-2 whitespace-nowrap
              ${activeTab === 'documents' ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <LayoutTemplate className="w-4 h-4" /> Colunas (Matriz)
          </button>
          <button
            onClick={() => setActiveTab('bindings')}
            className={`px-4 py-4 font-medium text-sm flex items-center gap-2 transition-colors border-b-2 whitespace-nowrap
              ${activeTab === 'bindings' ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <LinkIcon className="w-4 h-4" /> Vinculações
          </button>
          <button
            onClick={() => setActiveTab('due_dates')}
            className={`px-4 py-4 font-medium text-sm flex items-center gap-2 transition-colors border-b-2 whitespace-nowrap
              ${activeTab === 'due_dates' ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <CalendarDays className="w-4 h-4" /> Vencimentos
          </button>
          <button
            onClick={() => setActiveTab('daily')}
            className={`px-4 py-4 font-medium text-sm flex items-center gap-2 transition-colors border-b-2 whitespace-nowrap
              ${activeTab === 'daily' ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Clock className="w-4 h-4" /> Resumo Diário
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'signatures' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {/* Email Signature */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Mail className="w-4 h-4" /> Assinatura de E-mail (HTML)
                  </label>
                  <p className="text-xs text-gray-500">
                    Use <code>{`{mensagem_html}`}</code> onde o corpo do email deve ser inserido.
                  </p>
                  <textarea 
                    className="w-full h-80 border border-gray-300 rounded-lg p-3 font-mono text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                    value={formData.emailSignature}
                    onChange={(e) => setFormData({...formData, emailSignature: e.target.value})}
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-700">Pré-visualização</label>
                  <div className="w-full h-80 border border-gray-200 rounded-lg p-4 overflow-y-auto bg-gray-50">
                    <div 
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ 
                        __html: formData.emailSignature.replace('{mensagem_html}', '<p><em>[O conteúdo da mensagem será inserido aqui]</em></p>') 
                      }} 
                    />
                  </div>
                </div>
              </div>

              {/* WhatsApp Template */}
              <div className="space-y-2 pt-6 border-t border-gray-100">
                <label className="block text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" /> Assinatura / Rodapé do WhatsApp
                </label>
                <p className="text-xs text-gray-500">
                    Este texto será adicionado automaticamente ao final de todas as mensagens do WhatsApp.
                </p>
                <textarea 
                  className="w-full h-32 border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-green-500 outline-none"
                  value={formData.whatsappTemplate}
                  onChange={(e) => setFormData({...formData, whatsappTemplate: e.target.value})}
                />
              </div>
            </div>
          )}

          {activeTab === 'categories' && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-2xl">
                  <div className="mb-6">
                      <h3 className="font-semibold text-gray-800">Gerenciar Categorias de Documentos</h3>
                      <p className="text-sm text-gray-500">Crie novas categorias para organizar seus documentos.</p>
                  </div>

                  <div className="flex gap-2 mb-6">
                      <input 
                          type="text" 
                          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Nome da nova categoria..."
                          value={newCustomCategory}
                          onChange={(e) => setNewCustomCategory(e.target.value)}
                      />
                      <button 
                          onClick={addCustomCategory}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
                      >
                          <Plus className="w-4 h-4" /> Adicionar
                      </button>
                  </div>

                  <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-gray-700">Categorias Padrão</h4>
                      <div className="flex flex-wrap gap-2">
                          {DOCUMENT_CATEGORIES.map(cat => (
                              <span key={cat} className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm border border-gray-200">
                                  {cat}
                              </span>
                          ))}
                      </div>
                  </div>

                  <div className="space-y-2 mt-6">
                      <h4 className="text-sm font-semibold text-gray-700">Categorias Personalizadas</h4>
                      {(!formData.customCategories || formData.customCategories.length === 0) && (
                          <p className="text-sm text-gray-400 italic">Nenhuma categoria criada.</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                          {(formData.customCategories || []).map(cat => (
                              <span key={cat} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm border border-blue-200 flex items-center gap-2">
                                  {cat}
                                  <button onClick={() => removeCustomCategory(cat)} className="hover:text-red-500">
                                      <Trash className="w-3 h-3" />
                                  </button>
                              </span>
                          ))}
                      </div>
                  </div>
              </div>
          )}

          {activeTab === 'documents' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
               <div className="mb-6">
                 <h3 className="font-semibold text-gray-800">Visualização da Matriz de Documentos</h3>
                 <p className="text-sm text-gray-500">Selecione quais categorias devem aparecer como colunas na tabela de gerenciamento de documentos.</p>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                 {allCategories.map(category => {
                   const isSelected = formData.visibleDocumentCategories.includes(category);
                   return (
                     <label 
                        key={category} 
                        className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                          ${isSelected 
                            ? 'border-blue-500 bg-blue-50' 
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                     >
                       <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors
                          ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-400'}`}>
                          {isSelected && <Check className="w-3 h-3" />}
                       </div>
                       <input 
                          type="checkbox" 
                          className="hidden" 
                          checked={isSelected} 
                          onChange={() => toggleCategory(category)}
                        />
                       <span className={`font-medium ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>{category}</span>
                     </label>
                   );
                 })}
               </div>
            </div>
          )}

          {activeTab === 'bindings' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
               <div className="mb-6">
                 <h3 className="font-semibold text-gray-800">Palavras-chave e Prioridades</h3>
                 <p className="text-sm text-gray-500">
                     Configure as palavras-chave para identificar categorias. 
                     Use a <strong>Estrela</strong> para marcar categorias como prioritárias em caso de conflito.
                 </p>
               </div>

               {/* Add New Keyword */}
               <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 flex flex-col md:flex-row gap-4 items-end mb-8">
                  <div className="flex-1 w-full">
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Categoria Alvo</label>
                    <select 
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                      value={selectedCategoryForKeyword}
                      onChange={(e) => setSelectedCategoryForKeyword(e.target.value)}
                    >
                      {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="flex-[2] w-full">
                     <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Adicionar Nova Palavra-chave</label>
                     <input 
                        type="text" 
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                        placeholder="Ex: extrato mensal, das, nota fiscal..."
                        value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                     />
                  </div>
                  <button 
                    onClick={addKeyword}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Adicionar
                  </button>
               </div>

               {/* List Categories with Keywords Only */}
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {allCategories.map(category => {
                   const keywords = formData.categoryKeywords[category] || [];
                   const isPriority = (formData.priorityCategories || []).includes(category);

                   return (
                     <div key={category} className={`border rounded-lg overflow-hidden bg-white shadow-sm transition-all ${isPriority ? 'border-yellow-400 ring-1 ring-yellow-400' : 'border-gray-200'}`}>
                        <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-bold text-gray-700 flex justify-between items-center">
                           <span>{category}</span>
                           <button 
                             onClick={() => togglePriority(category)}
                             className={`p-1 rounded hover:bg-gray-200 transition-colors ${isPriority ? 'text-yellow-500' : 'text-gray-300'}`}
                             title={isPriority ? "Remover Prioridade" : "Marcar como Prioridade"}
                           >
                               <Star className={`w-5 h-5 ${isPriority ? 'fill-yellow-500' : ''}`} />
                           </button>
                        </div>
                        
                        <div className="p-4">
                           <div className="bg-gray-50 rounded border border-gray-200 p-2 min-h-[80px] space-y-2">
                            {keywords.length === 0 ? (
                                <p className="text-xs text-gray-400 italic p-2">Nenhuma palavra-chave definida.</p>
                            ) : (
                                keywords.map((kw, idx) => (
                                    <div key={idx} className="flex justify-between items-center bg-white border border-gray-200 rounded px-2 py-1">
                                    <span className="text-sm text-gray-700">{kw}</span>
                                    <button 
                                        onClick={() => removeKeyword(category, kw)}
                                        className="text-gray-400 hover:text-red-500 p-1"
                                        title="Remover palavra-chave"
                                    >
                                        <Trash className="w-3 h-3" />
                                    </button>
                                    </div>
                                ))
                            )}
                           </div>
                        </div>
                     </div>
                   );
                 })}
               </div>
            </div>
          )}

          {activeTab === 'due_dates' && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
                  <div className="mb-6">
                    <h3 className="font-semibold text-gray-800">Regras de Vencimento</h3>
                    <p className="text-sm text-gray-500">Configure como o sistema calcula a data de vencimento para cada categoria de documento.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {allCategories.map(category => {
                       const rule = formData.categoryRules[category] || { day: 10, rule: 'fixo' };
                       return (
                          <div key={category} className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
                              <div className="bg-blue-50 px-4 py-3 border-b border-blue-100 font-bold text-blue-800 flex justify-between items-center">
                                  <span>{category}</span>
                                  <Clock className="w-4 h-4 text-blue-400" />
                              </div>
                              <div className="p-4 space-y-4">
                                  <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Regra</label>
                                    <select 
                                      className="w-full text-sm border border-gray-300 rounded px-2 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                      value={rule.rule}
                                      onChange={(e) => updateRule(category, 'rule', e.target.value)}
                                    >
                                      <option value="fixo">Dia Fixo</option>
                                      <option value="antecipado">Antecipar se Feriado/FDS</option>
                                      <option value="postergado">Postergar se Feriado/FDS</option>
                                      <option value="quinto_dia_util">Quinto Dia Útil</option>
                                      <option value="ultimo_dia_util">Último Dia Útil</option>
                                    </select>
                                  </div>
                                  
                                  {(rule.rule === 'fixo' || rule.rule === 'antecipado' || rule.rule === 'postergado') && (
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Dia do Vencimento</label>
                                        <input 
                                          type="number" 
                                          min="1" 
                                          max="31" 
                                          className="w-full text-sm border border-gray-300 rounded px-2 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                          value={rule.day}
                                          onChange={(e) => updateRule(category, 'day', parseInt(e.target.value))}
                                        />
                                    </div>
                                  )}

                                  <div className="bg-gray-50 p-2 rounded text-xs text-gray-500 border border-gray-100 min-h-[40px]">
                                    {rule.rule === 'quinto_dia_util' && "Vence no 5º dia útil do mês seguinte."}
                                    {rule.rule === 'ultimo_dia_util' && "Vence no último dia útil do mês seguinte."}
                                    {rule.rule === 'antecipado' && `Vence dia ${rule.day}. Se cair em feriado/FDS, antecipa.`}
                                    {rule.rule === 'postergado' && `Vence dia ${rule.day}. Se cair em feriado/FDS, posterga.`}
                                    {rule.rule === 'fixo' && `Vence dia ${rule.day}, independente de ser útil.`}
                                  </div>
                              </div>
                          </div>
                       );
                    })}
                  </div>
              </div>
          )}

          {activeTab === 'daily' && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-2xl">
                  <div className="mb-6">
                      <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                         <Smartphone className="w-5 h-5 text-green-600" /> Resumo Diário de Tarefas (WhatsApp)
                      </h3>
                      <p className="text-sm text-gray-500">
                          Configure para receber um resumo automático das suas tarefas pendentes de Segunda a Sexta.
                      </p>
                  </div>

                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 space-y-6">
                      <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Número do WhatsApp (com DDD)</label>
                          <input 
                              type="text" 
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Ex: 75999999999"
                              value={formData.dailySummaryNumber || ''}
                              onChange={(e) => setFormData({...formData, dailySummaryNumber: e.target.value.replace(/\D/g, '')})}
                          />
                          <p className="text-xs text-gray-500 mt-1">Apenas números. O sistema enviará exclusivamente para este número.</p>
                      </div>

                      <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Horário de Envio</label>
                          <input 
                              type="time" 
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                              value={formData.dailySummaryTime || '08:00'}
                              onChange={(e) => setFormData({...formData, dailySummaryTime: e.target.value})}
                          />
                          <p className="text-xs text-gray-500 mt-1">O resumo será enviado de Segunda a Sexta neste horário.</p>
                      </div>

                      <div className="bg-blue-50 p-4 rounded text-sm text-blue-800 border border-blue-100 mb-4">
                          <strong>Como funciona:</strong><br/>
                          No horário definido, o sistema listará todas as tarefas <strong>Pendentes</strong> e <strong>Em Andamento</strong>, 
                          ordenadas por prioridade (Alta {'>'} Média {'>'} Baixa).
                      </div>

                      <button 
                        onClick={handleTestDaily}
                        disabled={loadingTest}
                        className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-3 rounded-lg hover:bg-green-700 shadow-lg shadow-green-500/20 font-medium transition-all disabled:opacity-70"
                      >
                          {loadingTest ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                          Disparar Resumo Agora (Teste)
                      </button>
                  </div>
              </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
