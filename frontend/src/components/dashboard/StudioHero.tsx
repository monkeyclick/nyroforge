import { BoltIcon } from '@heroicons/react/24/outline'

interface StudioHeroProps {
  onLaunch: () => void
}

export default function StudioHero({ onLaunch }: StudioHeroProps) {
  return (
    <section className="studio-hero mb-6">
      <div className="relative z-10 max-w-2xl">
        <p className="eyebrow text-cyan-300">Your creative studio</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Production power, ready when inspiration hits.</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">Launch, connect, and manage high-performance workstations for editing, VFX, animation, and realtime production.</p>
      </div>
      <button onClick={onLaunch} className="hero-action"><BoltIcon className="h-5 w-5" /> New workstation</button>
    </section>
  )
}
