'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

export type SpeechError = 'not-allowed' | 'no-speech' | 'network' | 'unsupported' | null

async function requestMicPermission(): Promise<boolean> {
  try {
    // Check current permission state first
    if (navigator.permissions) {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      if (result.state === 'denied') return false
      if (result.state === 'granted') return true
    }
    // Trigger permission prompt via getUserMedia
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    return false
  }
}

export function useSpeechRecognition(
  onTranscript: (text: string, isFinal?: boolean) => void,
  lang = 'en-US'
) {
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const [error, setError] = useState<SpeechError>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any -- SpeechRecognition vendor-prefixed API */
    const SR =
      typeof window !== 'undefined'
        ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
        : null
    /* eslint-enable @typescript-eslint/no-explicit-any */
    setIsSupported(!!SR && !!navigator.mediaDevices?.getUserMedia)
  }, [])

  const startListening = useCallback(async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any -- SpeechRecognition vendor-prefixed API */
    const SR =
      typeof window !== 'undefined'
        ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
        : null
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (!SR) return

    setError(null)

    // Request mic permission before starting (triggers browser prompt if needed)
    const granted = await requestMicPermission()
    if (!granted) {
      setError('not-allowed')
      setTimeout(() => setError(null), 4000)
      return
    }

    const recognition = new SR()
    recognition.lang = lang
    recognition.interimResults = true
    recognition.continuous = false

    let finalTranscript = ''

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalTranscript += t
        else interim = t
      }
      // Concatenate final + interim so text accumulates smoothly (no replacement jumps)
      onTranscript(finalTranscript + interim, false)
    }

    recognition.onend = () => {
      // Deliver final clean transcript before marking done
      if (finalTranscript) onTranscript(finalTranscript, true)
      setIsListening(false)
      recognitionRef.current = null
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (e: any) => {
      setIsListening(false)
      recognitionRef.current = null
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        setError('not-allowed')
      } else if (e.error === 'no-speech') {
        setError('no-speech')
      } else if (e.error === 'network') {
        setError('network')
      }
      // Auto-clear error after 4s
      setTimeout(() => setError(null), 4000)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setIsListening(true)
    } catch {
      setError('unsupported')
      setTimeout(() => setError(null), 4000)
    }
  }, [onTranscript, lang])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  const toggle = useCallback(() => {
    if (isListening) stopListening()
    else startListening()
  }, [isListening, startListening, stopListening])

  const errorMessage: string | null =
    error === 'not-allowed'
      ? '🎤 Microphone access denied — allow mic in browser settings'
      : error === 'no-speech'
        ? '🎤 No speech detected'
        : error === 'network'
          ? '🎤 Network error — please retry'
          : error === 'unsupported'
            ? '🎤 Not supported by this browser'
            : null

  return { isListening, isSupported, toggle, startListening, stopListening, error, errorMessage }
}
