
export type DemoUser = {
  fullName: string;
  email: string;
  role: 'staff' | 'manager' | 'hr';
  department: string;
};

export const demoUsers: DemoUser[] = [
  // ENGINEERING: 1 manager + 7 staff
  { fullName: 'Rohan Mehta', email: 'rohan@example.com', role: 'manager', department: 'Engineering' },
  { fullName: 'Aarav Sharma', email: 'aarav.staff@example.com', role: 'staff', department: 'Engineering' },
  { fullName: 'Priya Kapoor', email: 'priya@example.com', role: 'staff', department: 'Engineering' },
  { fullName: 'Aditya Verma', email: 'aditya@example.com', role: 'staff', department: 'Engineering' },
  { fullName: 'Neha Singh', email: 'neha@example.com', role: 'staff', department: 'Engineering' },
  { fullName: 'Karan Gupta', email: 'karan@example.com', role: 'staff', department: 'Engineering' },
  { fullName: 'Sneha Joshi', email: 'sneha@example.com', role: 'staff', department: 'Engineering' },
  { fullName: 'Vivek Kumar', email: 'vivek@example.com', role: 'staff', department: 'Engineering' },

  // SALES: 1 manager + 7 staff
  { fullName: 'Anjali Rao', email: 'anjali@example.com', role: 'manager', department: 'Sales' },
  { fullName: 'Rahul Shah', email: 'rahul@example.com', role: 'staff', department: 'Sales' },
  { fullName: 'Pooja Nair', email: 'pooja@example.com', role: 'staff', department: 'Sales' },
  { fullName: 'Amit Patel', email: 'amit@example.com', role: 'staff', department: 'Sales' },
  { fullName: 'Simran Kaur', email: 'simran@example.com', role: 'staff', department: 'Sales' },
  { fullName: 'Deepak Jain', email: 'deepak@example.com', role: 'staff', department: 'Sales' },
  { fullName: 'Riya Malhotra', email: 'riya@example.com', role: 'staff', department: 'Sales' },
  { fullName: 'Nikhil Arora', email: 'nikhil@example.com', role: 'staff', department: 'Sales' },

  // HUMAN RESOURCES: 1 manager + 6 staff
  { fullName: 'Meera Sethi', email: 'meera@example.com', role: 'manager', department: 'Human Resources' },
  { fullName: 'Tanya Bhat', email: 'tanya@example.com', role: 'staff', department: 'Human Resources' },
  { fullName: 'Ishita Sharma', email: 'ishita@example.com', role: 'staff', department: 'Human Resources' },
  { fullName: 'Varun Khanna', email: 'varun@example.com', role: 'staff', department: 'Human Resources' },
  { fullName: 'Nisha Gupta', email: 'nisha@example.com', role: 'staff', department: 'Human Resources' },
  { fullName: 'Sahil Kapoor', email: 'sahil@example.com', role: 'staff', department: 'Human Resources' },
  { fullName: 'Ayesha Khan', email: 'ayesha@example.com', role: 'staff', department: 'Human Resources' },

  // OPERATIONS: 1 manager + 6 staff
  { fullName: 'Arjun Malhotra', email: 'arjun@example.com', role: 'manager', department: 'Operations' },
  { fullName: 'Kabir Sood', email: 'kabir@example.com', role: 'staff', department: 'Operations' },
  { fullName: 'Kavya Sharma', email: 'kavya@example.com', role: 'staff', department: 'Operations' },
  { fullName: 'Manav Joshi', email: 'manav@example.com', role: 'staff', department: 'Operations' },
  { fullName: 'Divya Nair', email: 'divya@example.com', role: 'staff', department: 'Operations' },
  { fullName: 'Ritika Verma', email: 'ritika@example.com', role: 'staff', department: 'Operations' },
  { fullName: 'Harsh Patel', email: 'harsh@example.com', role: 'staff', department: 'Operations' },

  // ADDITIONAL HR ADMIN
  { fullName: 'Sonia Sharma', email: 'sonia.hr@example.com', role: 'hr', department: 'Human Resources' },
];
