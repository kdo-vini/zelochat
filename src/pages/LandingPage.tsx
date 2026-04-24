import { useEffect } from 'react';
import { Header } from '../components/landing/Header';
import { Hero } from '../components/landing/Hero';
import { IntegrationStrip } from '../components/landing/IntegrationStrip';
import { FeaturesGrid } from '../components/landing/FeaturesGrid';
import { HowItWorks } from '../components/landing/HowItWorks';
import { Pricing } from '../components/landing/Pricing';
import { Testimonials } from '../components/landing/Testimonials';
import { FAQ } from '../components/landing/FAQ';
import { BottomCTA } from '../components/landing/BottomCTA';
import { Footer } from '../components/landing/Footer';

export default function LandingPage() {
  useEffect(() => {
    document.body.classList.add('landing-theme');
    const prevTitle = document.title;
    document.title = 'ZeloChat — Atendimento com IA para o ZeloPDV';
    return () => {
      document.body.classList.remove('landing-theme');
      document.title = prevTitle;
    };
  }, []);

  return (
    <div className="landing-theme min-h-screen bg-[#0B1120]">
      <Header />
      <main>
        <Hero />
        <IntegrationStrip />
        <FeaturesGrid />
        <HowItWorks />
        <Pricing />
        <Testimonials />
        <FAQ />
        <BottomCTA />
      </main>
      <Footer />
    </div>
  );
}
