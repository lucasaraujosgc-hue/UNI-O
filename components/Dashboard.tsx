
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
import Kanban from './Kanban';
import DashboardCalendar from './DashboardCalendar';
import TaskModal from './TaskModal';
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
  
  // Modal states for Calendar interactions
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

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

  const handleTaskClick = (task: Task) => {
      setEditingTask(task);
      setIsTaskModalOpen(true);
  };

  const handleSaveTask = async (task: Task) => {
      try {
          await api.saveTask(task);
          setIsTaskModalOpen(false);
          loadData(); // Reload everything
      } catch (e) {
          alert("Erro ao salvar tarefa");
      }
  };

  const handleDeleteTask = async (taskId: number) => {
      try {
          await api.deleteTask(taskId);
          setIsTaskModalOpen(false);
          loadData();
      } catch (e) {
          alert("Erro ao excluir tarefa");
      }
  };

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
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Dashboard</h2>
          <p className="text-sm text-gray-500">Visão geral do seu escritório</p>
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

      {/* 1. Visão Geral Compacta */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <CompactStatCard 
          title="Empresas" 
          value={companiesCount} 
          icon={Building2} 
          color="bg-blue-500" 
        />
        <CompactStatCard 
          title="Pendências" 
          value={pendingTasks} 
          icon={Clock} 
          color="bg-yellow-500" 
        />
        <CompactStatCard 
          title="Urgentes" 
          value={urgentTasks.length} 
          icon={AlertCircle} 
          color="bg-red-500" 
        />
        <CompactStatCard 
          title="Envios (Hoje)" 
          value={recentSends.length} // Simplificação para demo
          icon={CheckCircle2} 
          color="bg-green-500" 
        />
      </div>

      {/* 2. Calendário Mensal em Destaque */}
      <div>
          <DashboardCalendar tasks={tasks} onTaskClick={handleTaskClick} />
      </div>

      {/* 3. Gerenciador de Tarefas (Kanban) */}
      <div className="pt-4 border-t border-gray-200">
          <Kanban />
      </div>

      {/* Modal para edição via Calendário */}
      <TaskModal 
        isOpen={isTaskModalOpen} 
        onClose={() => setIsTaskModalOpen(false)} 
        task={editingTask} 
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
      />
    </div>
  );
};

export default Dashboard;
