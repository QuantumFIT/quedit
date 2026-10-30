// Example circuits, as OpenQASM 3.

export const EXAMPLES = [
  {
    name: 'Bell pair',
    qasm: `OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
cx q[0], q[1];
c = measure q;
`,
  },
  {
    name: 'GHZ state (4 qubits)',
    qasm: `OPENQASM 3.0;
include "stdgates.inc";
qubit[4] q;
h q[0];
cx q[0], q[1];
cx q[1], q[2];
cx q[2], q[3];
`,
  },
  {
    name: 'Teleportation',
    qasm: `OPENQASM 3.0;
include "stdgates.inc";
qubit[3] q;
bit[2] c;
ry(pi/3) q[0];
barrier q;
h q[1];
cx q[1], q[2];
barrier q;
cx q[0], q[1];
h q[0];
c[0] = measure q[0];
c[1] = measure q[1];
if (c[1]) x q[2];
if (c[0]) z q[2];
`,
  },
  {
    name: 'QFT (3 qubits)',
    qasm: `OPENQASM 3.0;
include "stdgates.inc";
qubit[3] q;
h q[0];
cp(pi/2) q[1], q[0];
cp(pi/4) q[2], q[0];
h q[1];
cp(pi/2) q[2], q[1];
h q[2];
swap q[0], q[2];
`,
  },
  {
    name: 'Grover (2 qubits, marks |11⟩)',
    qasm: `OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q;
cz q[0], q[1];
h q;
x q;
cz q[0], q[1];
x q;
h q;
c = measure q;
`,
  },
  {
    name: 'Toffoli decomposition',
    qasm: `OPENQASM 3.0;
include "stdgates.inc";
qubit[3] q;
h q[2];
cx q[1], q[2];
tdg q[2];
cx q[0], q[2];
t q[2];
cx q[1], q[2];
tdg q[2];
cx q[0], q[2];
t q[1];
t q[2];
h q[2];
cx q[0], q[1];
t q[0];
tdg q[1];
cx q[0], q[1];
`,
  },
];
