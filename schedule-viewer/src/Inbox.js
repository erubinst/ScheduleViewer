import React, { useState }  from 'react';

function Inbox( {inboxMsgs} ) {
    // first msg, or nothing selected
    // const [selectedId, setSelectedId] = useState(inboxMsgs[0]?.id || null);
    const [selectedId, setSelectedId] = useState(null);
    const selectedMsg = inboxMsgs.find(msg => msg.id === selectedId);

    return (
        <div className="inbox-layout">
            <div className="inbox-list-pane">
                <h1 className="inbox-list-heading">Inbox</h1>
                {inboxMsgs.length === 0 ? (
                    <p>No messages in inbox.</p>
                ) : (
                    inboxMsgs.map(msg => (
                        <button
                            key={msg.id}
                            className={`inbox-list-item ${msg.id === selectedId ? 'active' : ''}`}
                            onClick={() => setSelectedId(msg.id)}
                        >
                            <div className="inbox-list-item-title">{msg.subject}</div>
                            <div className="inbox-list-item-summary">{msg.message}</div>
                    </button>
                    ))
                )}
            </div>

        <div className="inbox-detail-pane">
            <h1 className="inbox-detail-heading">Inbox Detail</h1>
            {selectedMsg ? (
                <>
                    <dl className="inbox-detail-fields">
                        <dt>Subject</dt>
                        <dd>{selectedMsg.subject}</dd>
                        <dt>Message:</dt>
                        <dd>{selectedMsg.message}</dd>
                        <dt>From</dt>
                        <dd>{selectedMsg.sender}</dd>
                        {/* <dt>When</dt> */}
                        {/* <dd>{selectedMsg.timestamp}</dd> */}
                        {/* add lines for whatever else exists on your object */}
                    </dl>
                </>
            ) : (
                <p>Select a message to view details.</p>
            )}
        </div>
    </div>
  );
}

export default Inbox;