import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(e, info) { console.error('ErrorBoundary caught:', e, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding:24, color:'#ff6060', fontFamily:'monospace', fontSize:12 }}>
          <div style={{ fontSize:16, marginBottom:12, color:'#ff4040' }}>⚠️ Render-Fehler</div>
          <div style={{ background:'rgba(255,0,0,.1)', padding:12, borderRadius:6, whiteSpace:'pre-wrap', wordBreak:'break-all' }}>
            {this.state.error.message}
          </div>
          <div style={{ marginTop:8, color:'#888', fontSize:10 }}>
            {this.state.error.stack?.split('\n').slice(0,5).join('\n')}
          </div>
          <button onClick={()=>this.setState({error:null})}
            style={{ marginTop:12, padding:'6px 16px', background:'#333', border:'1px solid #555', color:'#fff', borderRadius:4, cursor:'pointer' }}>
            Neu laden
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
