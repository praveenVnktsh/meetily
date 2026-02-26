'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { X, Check, Upload, RefreshCw, ListOrdered, Eye, Pause, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSidebar } from '../Sidebar/SidebarProvider';

interface QueueProgressEvent {
  task_id: string;
  task_type: 'Import' | 'Retranscribe';
  title: string;
  stage: string;
  progress_percentage: number;
  message: string;
  is_paused: boolean;
  queue_position: number | null;
  queue_total: number | null;
}

interface QueueCompleteEvent {
  task_id: string;
  task_type: 'Import' | 'Retranscribe';
  title: string;
  meeting_id: string;
  segments_count: number;
  duration_seconds: number;
}

interface QueueErrorEvent {
  task_id: string;
  task_type: 'Import' | 'Retranscribe';
  title: string;
  error: string;
}

interface QueueStatus {
  tasks: Array<{
    task_id: string;
    task_type: 'Import' | 'Retranscribe';
    title: string;
    status: string;
  }>;
  active_task_id: string | null;
  pending_count: number;
}

interface TaskState {
  task_id: string;
  task_type: 'Import' | 'Retranscribe';
  title: string;
  stage: string;
  progress_percentage: number;
  message: string;
  status: 'pending' | 'active' | 'paused' | 'completed' | 'error';
  error?: string;
  meeting_id?: string;
  queue_position?: number;
  queue_total?: number;
}

function TranscriptionToastContent({
  task,
  onCancel,
  onPause,
  onResume,
  onViewMeeting,
}: {
  task: TaskState;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onViewMeeting?: () => void;
}) {
  const isComplete = task.status === 'completed';
  const hasError = task.status === 'error';
  const isPending = task.status === 'pending';
  const isActive = task.status === 'active';
  const isPaused = task.status === 'paused';

  const Icon = task.task_type === 'Import' ? Upload : RefreshCw;
  const label = task.task_type === 'Import' ? 'Import' : 'Retranscribe';

  return (
    <div className="flex items-start gap-3 w-full max-w-sm bg-white rounded-lg shadow-lg border border-gray-200 p-3 relative">
      {/* Icon */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isComplete
            ? 'bg-green-100'
            : hasError
            ? 'bg-red-100'
            : isPending
            ? 'bg-yellow-50'
            : isPaused
            ? 'bg-orange-50'
            : 'bg-blue-50'
        }`}
      >
        {isComplete ? (
          <Check className="w-4 h-4 text-green-600" />
        ) : hasError ? (
          <X className="w-4 h-4 text-red-600" />
        ) : isPending ? (
          <ListOrdered className="w-4 h-4 text-yellow-600" />
        ) : isPaused ? (
          <Pause className="w-4 h-4 text-orange-600" />
        ) : (
          <Icon className="w-4 h-4 text-blue-600 animate-spin" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm font-medium text-gray-900 truncate">
            {label}: {task.title}
          </p>
        </div>

        {hasError ? (
          <p className="text-xs text-red-600 line-clamp-2">{task.error || 'Task failed'}</p>
        ) : isComplete ? (
          <div className="space-y-1">
            <p className="text-xs text-green-600">Complete</p>
            {onViewMeeting && (
              <button
                onClick={onViewMeeting}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                <Eye className="w-3 h-3" />
                View Meeting
              </button>
            )}
          </div>
        ) : isPending ? (
          <p className="text-xs text-yellow-700">
            Queued{task.queue_position ? ` (${task.queue_position} of ${task.queue_total})` : ''}
          </p>
        ) : (
          <>
            {/* Progress bar */}
            <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mb-1.5">
              <div
                className={`h-full rounded-full transition-all duration-300 ${isPaused ? 'bg-orange-400' : 'bg-blue-600'}`}
                style={{ width: `${task.progress_percentage}%` }}
              />
            </div>

            {/* Progress text */}
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span className="truncate mr-2">
                {isPaused ? 'Paused' : task.message}
              </span>
              <span className="text-gray-900 font-medium flex-shrink-0">
                {Math.round(task.progress_percentage)}%
              </span>
            </div>
          </>
        )}

        {/* Action buttons for active/paused/pending tasks */}
        {(isActive || isPaused || isPending) && (
          <div className="mt-1.5 flex items-center gap-3">
            {/* Pause/Resume button (only for active/paused tasks) */}
            {isActive && onPause && (
              <button
                onClick={onPause}
                className="text-xs text-gray-500 hover:text-orange-600 flex items-center gap-1"
              >
                <Pause className="w-3 h-3" />
                Pause
              </button>
            )}
            {isPaused && onResume && (
              <button
                onClick={onResume}
                className="text-xs text-orange-600 hover:text-blue-600 flex items-center gap-1"
              >
                <Play className="w-3 h-3" />
                Resume
              </button>
            )}
            {/* Cancel button */}
            {onCancel && (
              <button
                onClick={onCancel}
                className="text-xs text-gray-500 hover:text-red-600 flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function useTranscriptionProgressToast() {
  const [tasks, setTasks] = useState<Map<string, TaskState>>(new Map());
  const router = useRouter();
  const { refetchMeetings } = useSidebar();

  const updateTask = useCallback((taskId: string, data: Partial<TaskState>) => {
    setTasks((prev) => {
      const updated = new Map(prev);
      const existing = updated.get(taskId);
      if (existing) {
        updated.set(taskId, { ...existing, ...data });
      } else if (data.task_id) {
        updated.set(taskId, data as TaskState);
      }
      return updated;
    });
  }, []);

  const cleanupTask = useCallback((taskId: string, delay: number = 5000) => {
    setTimeout(() => {
      setTasks((prev) => {
        const updated = new Map(prev);
        updated.delete(taskId);
        return updated;
      });
    }, delay);
  }, []);

  const handleCancel = useCallback(async (taskId: string) => {
    try {
      await invoke('cancel_transcription_task', { taskId });
      toast.dismiss(`transcription-${taskId}`);
      setTasks((prev) => {
        const updated = new Map(prev);
        updated.delete(taskId);
        return updated;
      });
    } catch (err) {
      console.error('Failed to cancel task:', err);
    }
  }, []);

  const handlePause = useCallback(async (taskId: string) => {
    try {
      await invoke('pause_transcription_task', { taskId });
    } catch (err) {
      console.error('Failed to pause task:', err);
    }
  }, []);

  const handleResume = useCallback(async (taskId: string) => {
    try {
      await invoke('resume_transcription_task', { taskId });
    } catch (err) {
      console.error('Failed to resume task:', err);
    }
  }, []);

  const handleViewMeeting = useCallback(
    (meetingId: string) => {
      router.push(`/meeting-details?id=${meetingId}`);
    },
    [router]
  );

  // Show/update toasts when task state changes
  useEffect(() => {
    tasks.forEach((task) => {
      const toastId = `transcription-${task.task_id}`;

      const getDuration = () => {
        switch (task.status) {
          case 'completed':
            return 5000;
          case 'error':
            return 10000;
          default:
            return Infinity;
        }
      };

      toast.custom(
        () => (
          <TranscriptionToastContent
            task={task}
            onCancel={() => handleCancel(task.task_id)}
            onPause={task.status === 'active' ? () => handlePause(task.task_id) : undefined}
            onResume={task.status === 'paused' ? () => handleResume(task.task_id) : undefined}
            onViewMeeting={
              task.status === 'completed' && task.meeting_id
                ? () => handleViewMeeting(task.meeting_id!)
                : undefined
            }
          />
        ),
        {
          position: 'top-right',
          id: toastId,
          duration: getDuration(),
        }
      );
    });
  }, [tasks, handleCancel, handlePause, handleResume, handleViewMeeting]);

  // Listen to queue events
  useEffect(() => {
    const unlisteners: Promise<UnlistenFn>[] = [];

    // Progress events
    unlisteners.push(
      listen<QueueProgressEvent>('transcription-queue-progress', (event) => {
        const { task_id, task_type, title, stage, progress_percentage, message, is_paused, queue_position, queue_total } =
          event.payload;

        updateTask(task_id, {
          task_id,
          task_type,
          title,
          stage,
          progress_percentage,
          message,
          status: is_paused ? 'paused' : 'active',
          queue_position: queue_position ?? undefined,
          queue_total: queue_total ?? undefined,
        });
      })
    );

    // Complete events
    unlisteners.push(
      listen<QueueCompleteEvent>('transcription-queue-complete', (event) => {
        const { task_id, task_type, title, meeting_id, segments_count } = event.payload;

        updateTask(task_id, {
          task_id,
          task_type,
          title,
          status: 'completed',
          progress_percentage: 100,
          stage: 'complete',
          message: `${segments_count} segments created`,
          meeting_id,
        });

        // Refresh sidebar
        refetchMeetings();

        // Clean up after toast auto-dismisses
        cleanupTask(task_id, 6000);
      })
    );

    // Error events
    unlisteners.push(
      listen<QueueErrorEvent>('transcription-queue-error', (event) => {
        const { task_id, task_type, title, error } = event.payload;

        updateTask(task_id, {
          task_id,
          task_type,
          title,
          status: 'error',
          progress_percentage: 0,
          stage: 'error',
          message: error,
          error,
        });

        // Clean up after toast auto-dismisses
        cleanupTask(task_id, 11000);
      })
    );

    // Queue status events (for pending task positions)
    unlisteners.push(
      listen<QueueStatus>('transcription-queue-status', (event) => {
        const { tasks: queueTasks } = event.payload;

        setTasks((prev) => {
          const updated = new Map(prev);
          let pendingIndex = 0;
          const pendingCount = queueTasks.filter((t) => t.status === 'Pending').length;

          for (const qt of queueTasks) {
            if (qt.status === 'Pending') {
              pendingIndex++;
              const existing = updated.get(qt.task_id);
              if (!existing) {
                // New pending task we haven't seen yet
                updated.set(qt.task_id, {
                  task_id: qt.task_id,
                  task_type: qt.task_type,
                  title: qt.title,
                  stage: 'queued',
                  progress_percentage: 0,
                  message: 'Waiting in queue...',
                  status: 'pending',
                  queue_position: pendingIndex,
                  queue_total: pendingCount,
                });
              } else {
                updated.set(qt.task_id, {
                  ...existing,
                  status: 'pending',
                  queue_position: pendingIndex,
                  queue_total: pendingCount,
                });
              }
            } else if (qt.status === 'Paused') {
              const existing = updated.get(qt.task_id);
              if (existing) {
                updated.set(qt.task_id, { ...existing, status: 'paused' });
              }
            }
          }

          return updated;
        });
      })
    );

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, [updateTask, cleanupTask, refetchMeetings]);

  return { tasks };
}

export function TranscriptionProgressToastProvider() {
  useTranscriptionProgressToast();
  return null;
}
