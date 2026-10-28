import { Link } from 'react-router-dom';
import Board from '../components/Board.jsx';
import SearchStub from '../components/SearchStub.jsx';
import { Shield, Clock, Ticket } from '../components/Icons.jsx';
import { addDays, todayIST } from '../util.js';

export default function Home() {
  const d = addDays(todayIST(), 1);
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <h1>Book the exact seat. Keep it while you pay.</h1>
            <p className="lede">Pick your seat for your stretch of the journey. Nobody else can take it until your payment goes through.</p>
          </div>
          <Board />
        </div>
      </section>
      <div className="container">
        <SearchStub />
        <div className="route-links" aria-label="Popular routes">
          <Link to={`/search?from=MAS&to=MYS&date=${d}`}>Chennai to Mysuru</Link>
          <Link to={`/search?from=SBC&to=UBL&date=${d}`}>Bengaluru to Hubballi</Link>
          <Link to={`/search?from=SBC&to=MAQ&date=${d}`}>Bengaluru to Mangaluru</Link>
          <Link to={`/search?from=KPD&to=SBC&date=${d}`}>Katpadi to Bengaluru</Link>
        </div>
        <section className="perks" aria-label="Why RailRush">
          <div className="perk"><Ticket /><h3>Seats by the stretch</h3><p>A seat sold from Chennai to Katpadi is still free from Katpadi onward. You only block the stops you ride.</p></div>
          <div className="perk"><Clock /><h3>A five-minute hold</h3><p>Choose seats, pay at your pace, and watch the timer. If it runs out, the seats go back on sale and you are not charged.</p></div>
          <div className="perk"><Shield /><h3>Fair refunds</h3><p>Cancel from My bookings and see the exact refund before you confirm. If the operator cancels a train, you get everything back.</p></div>
        </section>
      </div>
    </>
  );
}
