import { notFound } from 'next/navigation';
import { getMethodology } from '../../../lib/api';
import { MethodologyGraph } from '../../../components/MethodologyGraph';
import { PhaseCards } from '../../../components/PhaseCards';

interface Props {
  params: Promise<{ name: string }>;
}

export default async function MethodologyPage({ params }: Props) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);

  let methodology;
  try {
    methodology = await getMethodology(decodedName);
  } catch {
    notFound();
  }

  return (
    <div className="method-split-page">
      <div className="method-split-graph">
        <div className="graph-area-header">
          <h1>{methodology.name}</h1>
          <p>{methodology.description}</p>
        </div>
        <MethodologyGraph methodology={methodology} />
      </div>
      <div className="method-split-phases">
        <PhaseCards phases={methodology.phases} />
      </div>
    </div>
  );
}
