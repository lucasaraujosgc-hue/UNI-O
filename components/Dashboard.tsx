
import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Loader2,
  Bot,
  Power
} from 'lucide-react';
import { Task, TaskStatus, UserSettings } from '../types';
import { DEFAULT_USER_SETTINGS } from '../constants';
import WhatsAppKanban from './WhatsAppKanban';
import CopilotPanel from './CopilotPanel';
import { api } from '../services/api';

// Stats mais compactos para o topo
const CompactStatCard: React.FC<{ title: string; value: string | number; icon: any; color: string }> = ({ title, value, icon: Icon, color }) => (
  <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex items-center justify-between">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
        <h3 className="text-xl font-bold text-gray-800 mt-1">{value}</h3>
      </div>
      <div className={`p-2 rounded-lg ${color} bg-opacity-10 text-opacity-100`}>
        <Icon className={`w-5 h-5 ${color.replace('bg-', 'text-')}`} />
      </div>
  </div>
);

const Dashboard: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recentSends, setRecentSends] = useState<any[]>([]);
  const [companiesCount, setCompaniesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isTogglingAi, setIsTogglingAi] = useState(false);

  const loadData = async () => {
    try {
      const [t, c, s, userSettings] = await Promise.all([
        api.getTasks(),
        api.getCompanies(),
        api.getRecentSends(),
        api.getSettings()
      ]);
      setTasks(t);
      setCompaniesCount(c.length);
      setRecentSends(s);
      setSettings(userSettings || DEFAULT_USER_SETTINGS);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggleAi = async () => {
    if (!settings) return;
    setIsTogglingAi(true);
    try {
      const currentAiEnabled = settings.aiEnabled !== false;
      const newSettings = { ...settings, aiEnabled: !currentAiEnabled };
      await api.saveSettings(newSettings);
      setSettings(newSettings);
    } catch (e) {
      alert("Erro ao alterar status da IA");
    } finally {
      setIsTogglingAi(false);
    }
  };

  const pendingTasks = tasks.filter(t => t.status !== TaskStatus.DONE).length;
  const urgentTasks = tasks.filter(t => t.priority === 'alta' && t.status !== TaskStatus.DONE);

  if (loading) return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

  const isAiEnabled = settings?.aiEnabled !== false;

  return (
    <div className="space-y-4 h-full flex flex-col p-4">
      <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600">
                <Bot className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">IA Copiloto & CRM</h2>
              <p className="text-sm text-gray-500">Gestão de Canais e Automações</p>
            </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border ${isAiEnabled ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
            <Bot className="w-4 h-4" />
            IA {isAiEnabled ? 'Ativada' : 'Desativada'}
          </div>
          <button
            onClick={toggleAi}
            disabled={isTogglingAi}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              isAiEnabled 
                ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200' 
                : 'bg-blue-600 text-white hover:bg-blue-700'
            } disabled:opacity-50`}
          >
            {isTogglingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
            {isAiEnabled ? 'Desativar IA' : 'Ativar IA'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
        <div className="flex-1 border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm flex flex-col min-h-0">
          <WhatsAppKanban />
        </div>
        <div className="w-80 hidden xl:block min-h-0">
          <CopilotPanel />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
