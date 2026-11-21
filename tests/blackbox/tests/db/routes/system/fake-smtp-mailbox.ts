import { createServer, type AddressInfo, type Socket } from 'node:net';

export type ReceivedMail = { to: string; subject: string };

const DATA_END = '\r\n.\r\n';

/**
 * An SMTP server holding every mail it receives, `to` being each recipient
 * of the envelope and `subject` the header as sent. It speaks what nodemailer
 * sends with `EMAIL_SMTP_IGNORE_TLS`: no TLS, no auth.
 */
export async function startFakeMailbox() {
	const receivedMails: ReceivedMail[] = [];

	const smtpServer = createServer((smtpSocket) => {
		answerSmtpSession(smtpSocket, receivedMails);
	});

	await new Promise<void>((resolveListen) => {
		smtpServer.listen(0, '127.0.0.1', resolveListen);
	});

	return {
		receivedMails,
		listeningPort: (smtpServer.address() as AddressInfo).port,
		stopListening() {
			return new Promise<void>((resolveClose) => {
				smtpServer.close(() => resolveClose());
			});
		},
	};
}

function answerSmtpSession(smtpSocket: Socket, receivedMails: ReceivedMail[]) {
	let unreadText = '';
	let envelopeRecipients: string[] = [];
	let isReadingData = false;

	const answerLine = (replyLine: string) => {
		smtpSocket.write(`${replyLine}\r\n`);
	};

	answerLine('220 fake-mailbox ESMTP');

	smtpSocket.on('data', (smtpChunk) => {
		unreadText += String(smtpChunk);

		for (;;) {
			if (isReadingData) {
				const dataEnd = unreadText.indexOf(DATA_END);

				if (dataEnd === -1) {
					return;
				}

				const mailSubject = readMailSubject(unreadText.slice(0, dataEnd));

				for (const envelopeRecipient of envelopeRecipients) {
					receivedMails.push({ to: envelopeRecipient, subject: mailSubject });
				}

				unreadText = unreadText.slice(dataEnd + DATA_END.length);
				envelopeRecipients = [];
				isReadingData = false;
				answerLine('250 OK');

				continue;
			}

			const lineEnd = unreadText.indexOf('\r\n');

			if (lineEnd === -1) {
				return;
			}

			const commandLine = unreadText.slice(0, lineEnd);
			unreadText = unreadText.slice(lineEnd + 2);
			const smtpVerb = commandLine.slice(0, 4).toUpperCase();

			if (smtpVerb === 'EHLO') {
				answerLine('250-fake-mailbox');
				answerLine('250 8BITMIME');
			}
			else if (smtpVerb === 'RCPT') {
				envelopeRecipients.push(/<([^>]*)>/.exec(commandLine)?.[1] ?? '');
				answerLine('250 OK');
			}
			else if (smtpVerb === 'DATA') {
				isReadingData = true;
				answerLine('354 End data with <CR><LF>.<CR><LF>');
			}
			else if (smtpVerb === 'QUIT') {
				answerLine('221 Bye');
				smtpSocket.end();

				return;
			}
			else {
				// HELO, MAIL, RSET, NOOP: nothing to hold.
				answerLine('250 OK');
			}
		}
	});

	// A client hanging up after its QUIT is no failure of the scenario.
	smtpSocket.on('error', (socketError: NodeJS.ErrnoException) => {
		if (socketError.code !== 'ECONNRESET') {
			throw socketError;
		}
	});
}

function readMailSubject(mailText: string): string {
	const mailHeaders = mailText.split('\r\n\r\n')[0]!.replace(/\r\n[ \t]+/g, ' ');
	const subjectHeader = /^Subject: (.*)$/im.exec(mailHeaders);

	if (subjectHeader === null) {
		throw new Error(`The fake mailbox got a mail with no subject: ${
			JSON.stringify(mailHeaders)
		}`);
	}

	return subjectHeader[1]!;
}
